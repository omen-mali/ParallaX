/**
 * Opt-in OpenAI-compatible live smoke. Not part of `pnpm test` or `pnpm run check`.
 *
 * Requires:
 *   PARALLAX_COMPATIBLE_LIVE_SMOKE=1
 *   API key for the env named in the smoke preset (default OPENAI_API_KEY)
 *   PARALLAX_COMPATIBLE_BASE_URL (http/https endpoint, no embedded credentials)
 *   PARALLAX_COMPATIBLE_MODEL (explicit model id)
 *
 * Optional:
 *   PARALLAX_COMPATIBLE_API_KEY_ENV (defaults to OPENAI_API_KEY)
 *
 * Retention/storage of the transcript is endpoint-defined; ParallaX makes no
 * retention guarantee for compatible providers.
 */
import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { config as loadDotenv } from "dotenv";

import { parseCompatibleBaseUrl } from "../src/importer/provider-config.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const require = createRequire(join(repoRoot, "package.json"));
const tsxLoader = pathToFileURL(require.resolve("tsx/esm")).href;
const fixturePath = join(repoRoot, "test/fixtures/compatible-smoke-chat.md");

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

  if (process.env.PARALLAX_COMPATIBLE_LIVE_SMOKE !== "1") {
    fail(
      "Refusing to run: set PARALLAX_COMPATIBLE_LIVE_SMOKE=1 to enable the compatible live smoke.",
    );
  }

  const apiKeyEnv =
    process.env.PARALLAX_COMPATIBLE_API_KEY_ENV !== undefined &&
    process.env.PARALLAX_COMPATIBLE_API_KEY_ENV.length > 0
      ? process.env.PARALLAX_COMPATIBLE_API_KEY_ENV
      : "OPENAI_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (apiKey === undefined || apiKey.length === 0) {
    fail(`Refusing to run: ${apiKeyEnv} is required for the compatible live smoke.`);
  }

  const rawBaseUrl = process.env.PARALLAX_COMPATIBLE_BASE_URL;
  if (rawBaseUrl === undefined || rawBaseUrl.length === 0) {
    fail(
      "Refusing to run: PARALLAX_COMPATIBLE_BASE_URL is required for the compatible live smoke.",
    );
  }
  let baseUrl: string;
  try {
    baseUrl = parseCompatibleBaseUrl(rawBaseUrl);
  } catch (error: unknown) {
    fail(error instanceof Error ? error.message : "Invalid baseUrl.");
  }

  const model = process.env.PARALLAX_COMPATIBLE_MODEL;
  if (model === undefined || model.length === 0) {
    fail(
      "Refusing to run: PARALLAX_COMPATIBLE_MODEL is required for the compatible live smoke.",
    );
  }

  await access(fixturePath);

  const root = await mkdtemp(join(tmpdir(), "parallax-compatible-smoke-"));
  const store = ".parallax-smoke";
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PARALLAX_MOCK;
  delete env.PARALLAX_PROVIDER;
  delete env.PARALLAX_MODEL;

  const init = await runCli(["init", "--root", root, "--store", store], env);
  if (init.code !== 0) {
    fail(`init failed:\n${init.stderr || init.stdout}`);
  }

  const localDir = join(root, store, ".local");
  await mkdir(localDir, { recursive: true });
  await writeFile(
    join(localDir, "providers.yaml"),
    [
      "provider: openai-compatible",
      `model: ${JSON.stringify(model)}`,
      `baseUrl: ${JSON.stringify(baseUrl)}`,
      `apiKeyEnv: ${apiKeyEnv}`,
      "",
    ].join("\n"),
    "utf8",
  );

  const imported = await runCli(
    [
      "import",
      fixturePath,
      "--root",
      root,
      "--store",
      store,
      "--provider",
      "openai-compatible",
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
  if (!source.includes("Decision: Keep compatible smoke one-call and gated")) {
    fail("Applied source transcript is missing expected evidence text.");
  }

  const decisions = await readdir(join(storeRoot, "decisions"));
  if (decisions.length < 1) {
    fail("Expected at least one applied decision record.");
  }

  process.stdout.write(
    `Compatible smoke passed in ${storeRoot} (one API request; preview+apply).\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
