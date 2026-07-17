import { describe, expect, it } from "vitest";

import { searchSnapshot } from "../../src/mcp/server.js";

describe("searchSnapshot", () => {
  it("boosts title and tag matches over body-only matches", () => {
    const results = searchSnapshot(
      {
        decisions: [
          {
            id: "dec_store",
            title: "Use a plain-file store",
            decision: "Keep all data versioned in Git.",
            tags: ["architecture"],
            status: "active",
            createdAt: "2026-07-17T00:00:00.000Z",
          },
          {
            id: "dec_git",
            title: "Keep data versioned",
            decision: "Use a store for data.",
            tags: ["workflow"],
            status: "active",
            createdAt: "2026-07-17T00:00:00.000Z",
          },
        ],
        tasks: [{ id: "task_store", title: "Document the store", status: "open" }],
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
