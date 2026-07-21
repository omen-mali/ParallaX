import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..");
const require = createRequire(join(repoRoot, "package.json"));
const tsxLoader = pathToFileURL(require.resolve("tsx/esm")).href;
const fixtureChat = `# Tiny plan

## User

Decision: Prefer mock isolation
Task: Cover CLI precedence
Question: Is mock the default?
Term: precedence - CLI then env then preset then mock
`;

function cleanChildEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "PARALLAX_PROVIDER",
    "PARALLAX_MOCK",
    "PARALLAX_MODEL",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "PARALLAX_GEMINI_LIVE_SMOKE",
  ]) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

async function runImport(
  root: string,
  args: string[],
  envOverrides: Record<string, string | undefined> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", tsxLoader, join(repoRoot, "src/cli.ts"), ...args],
      {
        cwd: repoRoot,
        env: cleanChildEnv(envOverrides),
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

async function prepareProject(options?: {
  preset?: string;
}): Promise<{ root: string; chatPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "parallax-cli-"));
  const chatPath = join(root, "chat.md");
  await writeFile(chatPath, fixtureChat, "utf8");
  const init = await runImport(root, ["init", "--root", root, "--store", ".parallax"]);
  expect(init.code, init.stderr).toBe(0);
  if (options?.preset !== undefined) {
    await mkdir(join(root, ".parallax", ".local"), { recursive: true });
    await writeFile(
      join(root, ".parallax", ".local", "providers.yaml"),
      options.preset,
      "utf8",
    );
  }
  return { root, chatPath };
}

describe("CLI provider precedence (subprocess)", () => {
  it("keeps a generic mock preview noninteractive and nonpersistent on piped stdio", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-cli-preview-"));
    const chatPath = join(root, "chat.md");
    await writeFile(chatPath, fixtureChat, "utf8");

    const result = await runImport(root, [
      "import",
      chatPath,
      "--root",
      root,
      "--mock",
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Mock proposal");
    expect(result.stdout).toContain("Preview only. Re-run with --apply to persist it.");
    await expect(access(join(root, ".parallax"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("uses --provider mock over a live env provider and live preset", async () => {
    const { root, chatPath } = await prepareProject({
      preset: "provider: openai\nmodel: gpt-test\napiKeyEnv: OPENAI_API_KEY\n",
    });

    const result = await runImport(
      root,
      ["import", chatPath, "--root", root, "--provider", "mock", "--apply"],
      {
        PARALLAX_PROVIDER: "openai",
        OPENAI_API_KEY: "should-not-be-used",
      },
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Mock proposal");
    expect(result.stdout).toContain("Applied proposal");
  });

  it("uses PARALLAX_PROVIDER=mock over a live preset", async () => {
    const { root, chatPath } = await prepareProject({
      preset: "provider: gemini\nmodel: gemini-test\napiKeyEnv: GEMINI_API_KEY\n",
    });

    const result = await runImport(
      root,
      ["import", chatPath, "--root", root, "--apply"],
      {
        PARALLAX_PROVIDER: "mock",
        GEMINI_API_KEY: "should-not-be-used",
      },
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Mock proposal");
  });

  it("uses a mock-only preset", async () => {
    const { root, chatPath } = await prepareProject({
      preset: "provider: mock\n",
    });

    const result = await runImport(root, [
      "import",
      chatPath,
      "--root",
      root,
      "--apply",
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Mock proposal");
  });

  it("defaults to mock when no provider configuration is present", async () => {
    const { root, chatPath } = await prepareProject();

    const result = await runImport(root, [
      "import",
      chatPath,
      "--root",
      root,
      "--apply",
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Mock proposal");
    expect(result.stdout).toContain("Applied proposal");
  });
});
