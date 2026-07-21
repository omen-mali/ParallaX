/**
 * Opt-in Claude live smoke. Not part of `pnpm test` or `pnpm run check`.
 *
 * Requires:
 *   PARALLAX_CLAUDE_LIVE_SMOKE=1
 *   ANTHROPIC_API_KEY
 *   PARALLAX_MODEL (explicit Claude model id)
 */
import { access, mkdtemp, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { config as loadDotenv } from "dotenv";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const require = createRequire(join(repoRoot, "package.json"));
const tsxLoader = pathToFileURL(require.resolve("tsx/esm")).href;
const fixturePath = join(repoRoot, "test/fixtures/claude-smoke-chat.md");

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", tsxLoader, join(repoRoot, "src/cli.ts"), ...args],
      {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function main(): Promise<void> {
  loadDotenv({ path: join(repoRoot, ".env"), quiet: true });

  if (process.env.PARALLAX_CLAUDE_LIVE_SMOKE !== "1") {
    fail(
      "Refusing to run: set PARALLAX_CLAUDE_LIVE_SMOKE=1 to enable the Claude live smoke.",
    );
  }
  if (
    process.env.ANTHROPIC_API_KEY === undefined ||
    process.env.ANTHROPIC_API_KEY.length === 0
  ) {
    fail("Refusing to run: ANTHROPIC_API_KEY is required for the Claude live smoke.");
  }
  if (
    process.env.PARALLAX_MODEL === undefined ||
    process.env.PARALLAX_MODEL.length === 0
  ) {
    fail("Refusing to run: PARALLAX_MODEL is required for the Claude live smoke.");
  }

  await access(fixturePath);

  const root = await mkdtemp(join(tmpdir(), "parallax-claude-smoke-"));
  const store = ".parallax-smoke";
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PARALLAX_MOCK;
  delete env.PARALLAX_PROVIDER;

  const init = await runCli(["init", "--root", root, "--store", store], env);
  if (init.code !== 0) {
    fail(`init failed:\n${init.stderr || init.stdout}`);
  }

  const imported = await runCli(
    [
      "import",
      fixturePath,
      "--root",
      root,
      "--store",
      store,
      "--provider",
      "claude",
      "--model",
      process.env.PARALLAX_MODEL,
      "--apply",
    ],
    env,
  );
  if (imported.code !== 0) {
    fail(`import failed:\n${imported.stderr || imported.stdout}`);
  }

  process.stdout.write(imported.stdout);

  const storeRoot = join(root, store);
  const sources = await readdir(join(storeRoot, "sources"));
  if (sources.length !== 1) {
    fail(`Expected one source record, found ${sources.length}.`);
  }
  const source = await readFile(join(storeRoot, "sources", sources[0]!), "utf8");
  if (!source.includes("Decision: Keep Claude smoke one-call and gated")) {
    fail("Applied source transcript is missing expected evidence text.");
  }

  const decisions = await readdir(join(storeRoot, "decisions"));
  if (decisions.length < 1) {
    fail("Expected at least one applied decision record.");
  }

  process.stdout.write(
    `Claude smoke passed in ${storeRoot} (one API request; preview+apply).\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
