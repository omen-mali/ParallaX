import { appendFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { StoreDigestSchema } from "../../src/contract/types.js";
import { parseGenericMarkdown } from "../../src/importer/generic.js";
import { distillWithMock } from "../../src/importer/mock-distiller.js";
import { verifyImportDelta } from "../../src/importer/verify.js";
import { readStore, toStoreDigest } from "../../src/store/read.js";
import {
  applyImport,
  initializeStore,
  resolveStoreRoot,
  storePaths,
} from "../../src/store/store.js";

const emptyDigest = StoreDigestSchema.parse({
  activeDecisions: [],
  openTasks: [],
  openQuestions: [],
  omittedRecordCount: 0,
});

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "parallax-read-"));
}

describe("readStore", () => {
  it("reads every approved record type with stored evidence", async () => {
    const projectRoot = await tempRoot();
    const storeRoot = resolveStoreRoot(projectRoot);
    const fixture = await readFile(
      join(process.cwd(), "test/fixtures/marked-chat.md"),
      "utf8",
    );
    const parsed = parseGenericMarkdown(fixture, "marked-chat.md");
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

    // Mock distiller does not emit spec changes; seed one owned block.
    await appendFile(
      storePaths(storeRoot).specChanges,
      `\n<!-- PARALLAX:SPEC\nid: spec_seeded0000001\n-->\n## Compiler markers\n\nOperation: add\n\nDocument managed blocks.\n\n> Decision: Compile before MCP\n<!-- PARALLAX:SPEC:END -->\n`,
      "utf8",
    );

    const snapshot = await readStore(storeRoot);
    expect(snapshot.decisions.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.tasks.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.questions.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.glossary.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.specChanges).toHaveLength(1);
    expect(snapshot.sources).toHaveLength(1);
    expect(snapshot.omittedRecordCount).toBe(0);

    const decision = snapshot.decisions[0];
    expect(decision?.evidence.quote.length).toBeGreaterThan(0);
    expect(decision?.evidence.sourceId).toMatch(/^src_/);
    expect(typeof decision?.evidence.turnIndex).toBe("number");
    expect(decision?.context.length).toBeGreaterThan(0);

    const task = snapshot.tasks[0];
    expect(task?.evidence.quote.length).toBeGreaterThan(0);
    expect(task?.evidence.sourceId).toMatch(/^src_/);

    expect(snapshot.questions[0]?.evidence.quote.length).toBeGreaterThan(0);
    expect(snapshot.questions[0]?.evidence.sourceId).toBeUndefined();
    expect(snapshot.glossary[0]?.term.toLowerCase()).toContain("provenance");
    expect(snapshot.specChanges[0]).toMatchObject({
      section: "Compiler markers",
      operation: "add",
    });

    const digest = toStoreDigest(snapshot);
    expect(digest.openQuestions.length).toBe(snapshot.questions.length);
    expect(digest.openQuestions[0]?.question).toBe(snapshot.questions[0]?.question);
    expect(digest.omittedRecordCount).toBe(0);
  });

  it("exposes metadata-only sources without inventing transcript links", async () => {
    const projectRoot = await tempRoot();
    const storeRoot = resolveStoreRoot(projectRoot);
    const parsed = parseGenericMarkdown(
      "## User\n\nDecision: Keep retention explicit",
      "meta.md",
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

    const snapshot = await readStore(storeRoot);
    expect(snapshot.sources).toHaveLength(1);
    expect(snapshot.sources[0]?.metadataOnly).toBe(true);
    expect(snapshot.decisions[0]?.evidence.sourceId).toBe(snapshot.sources[0]?.id);
  });

  it("skips malformed owned blocks and counts them", async () => {
    const projectRoot = await tempRoot();
    const storeRoot = resolveStoreRoot(projectRoot);
    const paths = await initializeStore(storeRoot);

    await writeFile(
      paths.tasks,
      `# ParallaX Tasks

<!-- PARALLAX:TASK
id: task_good000000001
sourceId: src_${"a".repeat(64)}
turnIndex: 0
quoteHash: ${"b".repeat(64)}
createdAt: 2026-07-17T00:00:00.000Z
-->
- [ ] Good task

> Exact quote for the good task
<!-- PARALLAX:TASK:END -->

<!-- PARALLAX:TASK
not: valid
-->
- [ ] Broken metadata

> quote
<!-- PARALLAX:TASK:END -->
`,
      "utf8",
    );

    await writeFile(
      paths.questions,
      `# ParallaX Questions

<!-- PARALLAX:QUESTION
id: question_good00001
-->
## Should we keep fail-safe parsing?

Status: open

> Should we keep fail-safe parsing?
<!-- PARALLAX:QUESTION:END -->

<!-- PARALLAX:QUESTION
id: question_broken0001
-->
## Missing status and quote
<!-- PARALLAX:QUESTION:END -->
`,
      "utf8",
    );

    await mkdir(paths.decisions, { recursive: true });

    const snapshot = await readStore(storeRoot);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0]?.title).toBe("Good task");
    expect(snapshot.questions).toHaveLength(1);
    expect(snapshot.questions[0]?.question).toContain("fail-safe");
    expect(snapshot.omittedRecordCount).toBeGreaterThanOrEqual(2);

    const digest = toStoreDigest(snapshot);
    expect(digest.omittedRecordCount).toBe(snapshot.omittedRecordCount);
    expect(digest.openQuestions).toHaveLength(1);
  });
});
