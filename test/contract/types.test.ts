import { describe, expect, it } from "vitest";

import {
  EvidenceSchema,
  ImportDeltaSchema,
  SourceRecordSchema,
} from "../../src/contract/types.js";

const sourceId = `src_${"a".repeat(64)}`;

describe("ImportDeltaSchema", () => {
  it("accepts required nullable model-facing fields", () => {
    const result = ImportDeltaSchema.parse({
      summary: "A focused implementation plan.",
      decisions: [
        {
          title: "Use a plain-file store",
          context: "The project needs reviewable history.",
          decision: "Use Markdown and YAML files.",
          rationale: "They are easy to diff in Git.",
          alternatives: ["Use SQLite"],
          supersedes: null,
          tags: ["architecture"],
          evidence: {
            turnIndex: 2,
            quote: "Plain files are git-diffable.",
          },
        },
      ],
      tasks: [
        {
          title: "Build the importer",
          detail: null,
          evidence: {
            turnIndex: 3,
            quote: "Start with the importer.",
          },
        },
      ],
      questions: [],
      glossary: [],
      specChanges: [],
    });

    expect(result.tasks[0]?.detail).toBeNull();
    expect(result.decisions[0]?.supersedes).toBeNull();
  });

  it("rejects missing fields and unexpected model output", () => {
    const candidate = {
      summary: "A summary.",
      decisions: [],
      tasks: [],
      questions: [],
      glossary: [],
      specChanges: [],
    };

    expect(ImportDeltaSchema.safeParse(candidate).success).toBe(true);
    expect(
      ImportDeltaSchema.safeParse({ ...candidate, unexpected: true }).success,
    ).toBe(false);
    expect(
      ImportDeltaSchema.safeParse({
        ...candidate,
        tasks: [{ title: "Incomplete" }],
      }).success,
    ).toBe(false);
  });
});

describe("EvidenceSchema", () => {
  it("requires an exact-length character span", () => {
    const evidence = {
      sourceId,
      turnIndex: 0,
      role: "user" as const,
      quote: "exact quote",
      startChar: 10,
      endChar: 21,
    };

    expect(EvidenceSchema.safeParse(evidence).success).toBe(true);
    expect(EvidenceSchema.safeParse({ ...evidence, endChar: 22 }).success).toBe(false);
  });
});

describe("SourceRecordSchema", () => {
  it("validates provenance metadata", () => {
    expect(
      SourceRecordSchema.safeParse({
        schemaVersion: 1,
        kind: "source",
        id: sourceId,
        source: "generic",
        title: null,
        rawHash: "b".repeat(64),
        canonicalHash: "c".repeat(64),
        importedAt: "2026-07-17T12:00:00.000Z",
        turnCount: 1,
      }).success,
    ).toBe(true);
  });
});
