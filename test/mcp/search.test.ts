import { describe, expect, it } from "vitest";

import { searchSnapshot } from "../../src/mcp/server.js";
import type { StoreSnapshot } from "../../src/store/read.js";

const emptyLists = {
  questions: [],
  glossary: [],
  specChanges: [],
  sources: [],
  omittedRecordCount: 0,
} satisfies Pick<
  StoreSnapshot,
  "questions" | "glossary" | "specChanges" | "sources" | "omittedRecordCount"
>;

describe("searchSnapshot", () => {
  it("boosts title and tag matches over body-only matches", () => {
    const results = searchSnapshot(
      {
        decisions: [
          {
            id: "dec_store",
            title: "Use a plain-file store",
            decision: "Keep all data versioned in Git.",
            context: "Architecture choice.",
            rationale: "Git-friendly.",
            alternatives: [],
            tags: ["architecture"],
            status: "active",
            createdAt: "2026-07-17T00:00:00.000Z",
            updatedAt: "2026-07-17T00:00:00.000Z",
            evidence: { quote: "Use a plain-file store" },
          },
          {
            id: "dec_git",
            title: "Keep data versioned",
            decision: "Use a store for data.",
            context: "Workflow choice.",
            rationale: "Traceability.",
            alternatives: [],
            tags: ["workflow"],
            status: "active",
            createdAt: "2026-07-17T00:00:00.000Z",
            updatedAt: "2026-07-17T00:00:00.000Z",
            evidence: { quote: "Keep data versioned" },
          },
        ],
        tasks: [
          {
            id: "task_store",
            title: "Document the store",
            status: "open",
            evidence: { quote: "Document the store" },
          },
        ],
        ...emptyLists,
      },
      "store architecture",
    );

    expect(results.map((result) => result.id)).toEqual([
      "dec_store",
      "task_store",
      "dec_git",
    ]);
  });
});
