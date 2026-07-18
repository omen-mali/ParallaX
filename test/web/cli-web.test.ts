import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { StoreDigestSchema } from "../../src/contract/types.js";
import { parseGenericMarkdown } from "../../src/importer/generic.js";
import { distillWithMock } from "../../src/importer/mock-distiller.js";
import { verifyImportDelta } from "../../src/importer/verify.js";
import { applyImport, resolveStoreRoot } from "../../src/store/store.js";

const execFileAsync = promisify(execFile);

const emptyDigest = StoreDigestSchema.parse({
  activeDecisions: [],
  openTasks: [],
  openQuestions: [],
  omittedRecordCount: 0,
});

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "parallax-web-cli-"));
}

async function seedStore(
  storeRoot: string,
  title: string,
  filename: string,
): Promise<void> {
  const parsed = parseGenericMarkdown(`## User\n\nDecision: ${title}`, filename);
  const delta = verifyImportDelta(
    distillWithMock(parsed.chat),
    parsed.chat,
    emptyDigest,
  );
  await applyImport({
    storeRoot,
    chat: parsed.chat,
    rawHash: parsed.rawHash,
    delta,
    metadataOnly: false,
  });
}

describe("parallax web CLI", () => {
  it("reads only the selected store when generating --out", async () => {
    const projectRoot = await tempRoot();
    const defaultStore = resolveStoreRoot(projectRoot);
    const localStore = resolveStoreRoot(projectRoot, ".parallax.local");
    await seedStore(defaultStore, "Default store decision", "default.md");
    await seedStore(localStore, "Selected store decision", "local.md");

    const outputPath = join(projectRoot, "out", "brain.html");
    const cliPath = join(process.cwd(), "src/cli.ts");
    const tsxPath = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");

    await execFileAsync(
      process.execPath,
      [
        tsxPath,
        cliPath,
        "web",
        "--root",
        projectRoot,
        "--store",
        ".parallax.local",
        "--out",
        "out/brain.html",
      ],
      {
        env: { ...process.env, PARALLAX_MOCK: "1" },
      },
    );

    const html = await readFile(outputPath, "utf8");
    expect(html).toContain("Selected store decision");
    expect(html).not.toContain("Default store decision");
  });
});
