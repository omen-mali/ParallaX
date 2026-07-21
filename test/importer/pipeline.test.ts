import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  DecisionRecordSchema,
  SourceRecordSchema,
  StoreDigestSchema,
} from "../../src/contract/types.js";
import { parseGenericMarkdown } from "../../src/importer/generic.js";
import { distillWithMock } from "../../src/importer/mock-distiller.js";
import { verifyImportDelta } from "../../src/importer/verify.js";
import {
  applyImport,
  initializeStore,
  resolveStoreRoot,
  sourceAlreadyImported,
} from "../../src/store/store.js";

const chatExport = `# Build plan\n\n## User\n\nDecision: Use a plain-file store\nTask: Add marker tests\nQuestion: Should MCP write data?\nTerm: provenance - exact supporting chat text\n\n## Assistant\n\nDecision: Compile before MCP\n`;

const emptyDigest = StoreDigestSchema.parse({
  activeDecisions: [],
  openTasks: [],
  openQuestions: [],
  omittedRecordCount: 0,
});

describe("generic import pipeline", () => {
  it("parses, verifies, and applies a mock proposal", async () => {
    const parsed = parseGenericMarkdown(chatExport, "plan.md");
    const proposal = verifyImportDelta(
      distillWithMock(parsed.chat),
      parsed.chat,
      emptyDigest,
    );
    const root = await mkdtemp(join(tmpdir(), "parallax-test-"));
    const storeRoot = resolveStoreRoot(root);

    await initializeStore(storeRoot);
    await applyImport({
      storeRoot,
      chat: parsed.chat,
      rawHash: parsed.rawHash,
      delta: proposal,
      metadataOnly: false,
    });

    expect(await sourceAlreadyImported(storeRoot, parsed.chat.id)).toBe(true);
    await expect(
      readFile(join(root, ".parallax", "tasks.md"), "utf8"),
    ).resolves.toContain("Add marker tests");
    await expect(
      readFile(join(root, ".parallax", "sources", `${parsed.chat.id}.md`), "utf8"),
    ).resolves.toContain("Decision: Use a plain-file store");

    const source = await readFile(
      join(root, ".parallax", "sources", `${parsed.chat.id}.md`),
      "utf8",
    );
    const sourceMetadata = parse(source.match(/^---\n([\s\S]*?)---/m)?.[1] ?? "");
    expect(SourceRecordSchema.safeParse(sourceMetadata).success).toBe(true);

    const [decisionFile] = await readdir(join(root, ".parallax", "decisions"));
    const decision = await readFile(
      join(root, ".parallax", "decisions", decisionFile ?? ""),
      "utf8",
    );
    const decisionMetadata = parse(decision.match(/^---\n([\s\S]*?)---/m)?.[1] ?? "");
    expect(DecisionRecordSchema.safeParse(decisionMetadata).success).toBe(true);
  });

  it("rejects absent and ambiguous evidence quotes", () => {
    const parsed = parseGenericMarkdown("## User\n\nrepeat repeat", "repeat.md");
    const base = distillWithMock(parsed.chat);

    expect(() =>
      verifyImportDelta(
        {
          ...base,
          tasks: [
            {
              title: "Bad evidence",
              detail: null,
              evidence: { turnIndex: 0, quote: "missing" },
            },
          ],
        },
        parsed.chat,
        emptyDigest,
      ),
    ).toThrow("absent");
    expect(() =>
      verifyImportDelta(
        {
          ...base,
          tasks: [
            {
              title: "Ambiguous evidence",
              detail: null,
              evidence: { turnIndex: 0, quote: "repeat" },
            },
          ],
        },
        parsed.chat,
        emptyDigest,
      ),
    ).toThrow("more than once");
  });
});
