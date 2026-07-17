import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { compileContext } from "../../src/compiler/compiler.js";
import { StoreDigestSchema } from "../../src/contract/types.js";
import { parseGenericMarkdown } from "../../src/importer/generic.js";
import { distillWithMock } from "../../src/importer/mock-distiller.js";
import { verifyImportDelta } from "../../src/importer/verify.js";
import { readStore } from "../../src/store/read.js";
import {
  applyImport,
  initializeStore,
  resolveStoreRoot,
  storePaths,
} from "../../src/store/store.js";
import { generateTimeline } from "../../src/web/timeline.js";

const emptyDigest = StoreDigestSchema.parse({
  activeDecisions: [],
  openTasks: [],
  openQuestions: [],
  omittedRecordCount: 0,
});

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "parallax-store-"));
}

describe("resolveStoreRoot", () => {
  it("resolves default and custom stores under the project root", async () => {
    const projectRoot = await tempRoot();

    expect(resolveStoreRoot(projectRoot)).toBe(join(projectRoot, ".parallax"));
    expect(resolveStoreRoot(projectRoot, ".parallax.local")).toBe(
      join(projectRoot, ".parallax.local"),
    );
  });

  it("rejects stores outside or equal to the project root", async () => {
    const projectRoot = await tempRoot();

    expect(() => resolveStoreRoot(projectRoot, "..")).toThrow(/inside/);
    expect(() => resolveStoreRoot(projectRoot, ".")).toThrow(/inside/);
    expect(() => resolveStoreRoot(projectRoot, "/tmp/store")).toThrow(/relative/);
  });
});

describe("custom stores", () => {
  it("creates a deterministic interpretation-only manifest", async () => {
    const projectRoot = await tempRoot();
    const storeRoot = resolveStoreRoot(projectRoot, ".parallax.local");
    const paths = await initializeStore(storeRoot);

    const manifest = parse(await readFile(paths.manifest, "utf8"));
    expect(manifest).toEqual({ schemaVersion: 1, kind: "manifest" });
    expect(manifest).not.toHaveProperty("createdAt");

    await writeFile(paths.manifest, "schemaVersion: 1\nkind: manifest\ncustom: keep\n");
    await initializeStore(storeRoot);
    await expect(readFile(paths.manifest, "utf8")).resolves.toContain("custom: keep");
  });

  it("feeds apply, read, compile, and timeline from the selected store", async () => {
    const projectRoot = await tempRoot();
    const storeRoot = resolveStoreRoot(projectRoot, ".parallax.local");
    const parsed = parseGenericMarkdown(
      "## User\n\nDecision: Keep the selected store explicit",
      "store.md",
    );
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

    const snapshot = await readStore(storeRoot);
    expect(snapshot.decisions).toHaveLength(1);
    expect(snapshot.decisions[0]?.title).toBe("Keep the selected store explicit");

    await compileContext(projectRoot, storeRoot, ["agents"]);
    await expect(readFile(join(projectRoot, "AGENTS.md"), "utf8")).resolves.toContain(
      "Keep the selected store explicit",
    );

    const timelinePath = join(projectRoot, "timeline.html");
    await generateTimeline(storeRoot, timelinePath);
    await expect(readFile(timelinePath, "utf8")).resolves.toContain(
      "Keep the selected store explicit",
    );
  });

  it("makes transcript retention an explicit per-import choice", async () => {
    const projectRoot = await tempRoot();
    const storeRoot = resolveStoreRoot(projectRoot);
    const parsed = parseGenericMarkdown(
      "## User\n\nTask: Do not retain this sensitive sentence",
      "sensitive.md",
    );
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
      metadataOnly: true,
    });

    const source = await readFile(
      join(storePaths(storeRoot).sources, `${parsed.chat.id}.md`),
      "utf8",
    );
    expect(source).toContain("metadataOnly: true");
    expect(source).toContain("Transcript retention was disabled.");
    expect(source).not.toContain("Do not retain this sensitive sentence");
  });
});
