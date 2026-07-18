import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const fixturePath = join(projectRoot, "test", "fixtures", "chatgpt-conversations.json");

async function runCli(...args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", ...args],
      {
        cwd: projectRoot,
        env: { ...process.env, PARALLAX_MOCK: "1" },
      },
    );
    return `${stdout}${stderr}`;
  } catch (error: unknown) {
    const result = error as { stdout?: string; stderr?: string };
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  }
}

describe("ChatGPT CLI import", () => {
  it("does not write when a multi-conversation export has no selected ID", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-chatgpt-cli-"));

    const output = await runCli(
      "import",
      fixturePath,
      "--format",
      "chatgpt",
      "--mock",
      "--root",
      root,
    );

    expect(output).toContain("Use --conversation <id>");
    await expect(
      readFile(join(root, ".parallax", "tasks.md"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("imports only the selected ChatGPT conversation in mock mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-chatgpt-cli-"));

    const output = await runCli(
      "import",
      fixturePath,
      "--format",
      "chatgpt",
      "--conversation",
      "conv_project_brain",
      "--mock",
      "--apply",
      "--root",
      root,
    );

    expect(output).toContain("Applied proposal to");
    const sourceEntries = await readFile(join(root, ".parallax", "tasks.md"), "utf8");
    expect(sourceEntries).toContain("ship the static explorer");

    const sourceDirectory = join(root, ".parallax", "sources");
    const [sourceFile] = await readdir(sourceDirectory);
    const source = await readFile(join(sourceDirectory, sourceFile ?? ""), "utf8");
    const metadata = parse(source.match(/^---\n([\s\S]*?)---/m)?.[1] ?? "") as {
      source?: string;
    };
    expect(metadata.source).toBe("chatgpt");
    expect(source).not.toContain("Ignore this old branch.");
  });
});
