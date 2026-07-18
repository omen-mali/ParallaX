import { describe, expect, it } from "vitest";

import type { StoreSnapshot } from "../../src/store/read.js";
import { renderTimelineHtml } from "../../src/web/timeline.js";

function emptySnapshot(overrides: Partial<StoreSnapshot> = {}): StoreSnapshot {
  return {
    decisions: [],
    tasks: [],
    questions: [],
    glossary: [],
    specChanges: [],
    sources: [],
    omittedRecordCount: 0,
    ...overrides,
  };
}

describe("renderTimelineHtml", () => {
  it("embeds snapshot data without an external runtime", () => {
    const html = renderTimelineHtml(
      emptySnapshot({
        decisions: [
          {
            id: "dec_test",
            title: "Use static HTML",
            decision: "Generate one self-contained file.",
            context: "Portable docs.",
            rationale: "No framework.",
            alternatives: [],
            tags: ["web"],
            status: "active",
            createdAt: "2026-07-17T00:00:00.000Z",
            updatedAt: "2026-07-17T00:00:00.000Z",
            evidence: {
              quote: "Generate one self-contained file.",
              sourceId: `src_${"c".repeat(64)}`,
              turnIndex: 0,
            },
          },
        ],
      }),
      { generatedAt: "2026-07-18T12:00:00.000Z" },
    );

    expect(html).toContain("Use static HTML");
    expect(html).toContain("2026-07-18T12:00:00.000Z");
    expect(html).toContain("Active decisions");
    expect(html).toContain("Open tasks");
    expect(html).toContain("Questions");
    expect(html).toContain("Glossary");
    expect(html).toContain("Spec changes");
    expect(html).not.toContain("<script src=");
  });

  it("renders empty states and escapes embedded angle brackets", () => {
    const html = renderTimelineHtml(
      emptySnapshot({
        decisions: [
          {
            id: "dec_xss",
            title: "Escape script tags",
            decision: "Treat </script><img src=x onerror=alert(1)> as text.",
            context: "Safety",
            rationale: "textContent only",
            alternatives: [],
            tags: [],
            status: "active",
            createdAt: "2026-07-17T00:00:00.000Z",
            updatedAt: "2026-07-17T00:00:00.000Z",
            evidence: { quote: "<script>alert(1)</script>" },
          },
        ],
      }),
      { generatedAt: "2026-07-18T12:00:00.000Z" },
    );

    expect(html).toContain("\\u003cscript>alert(1)\\u003c/script>");
    expect(html).toContain("No open tasks.");
    expect(html).toContain("No questions recorded.");
    expect(html).toContain("No glossary terms recorded.");
    expect(html).toContain("No spec changes recorded.");
  });

  it("preserves provenance and metadata-only notices in embedded data", () => {
    const sourceId = `src_${"d".repeat(64)}`;
    const html = renderTimelineHtml(
      emptySnapshot({
        decisions: [
          {
            id: "dec_meta",
            title: "Retention choice",
            decision: "Keep metadata-only imports explicit.",
            context: "Privacy",
            rationale: "No silent retention.",
            alternatives: [],
            tags: ["privacy"],
            status: "active",
            createdAt: "2026-07-17T00:00:00.000Z",
            updatedAt: "2026-07-17T00:00:00.000Z",
            evidence: {
              quote: "Keep metadata-only imports explicit.",
              sourceId,
              turnIndex: 1,
              role: "user",
            },
          },
        ],
        questions: [
          {
            id: "question_quote_only",
            question: "Is quote-only evidence enough?",
            status: "open",
            evidence: { quote: "Is quote-only evidence enough?" },
          },
        ],
        sources: [
          {
            id: sourceId,
            title: "Sensitive chat",
            metadataOnly: true,
            importedAt: "2026-07-17T00:00:00.000Z",
          },
        ],
      }),
      { generatedAt: "2026-07-18T12:00:00.000Z" },
    );

    expect(html).toContain(sourceId);
    expect(html).toContain('"metadataOnly":true');
    expect(html).toContain("Transcript retention was disabled.");
    expect(html).toContain("Stored evidence quote only");
    expect(html).toContain("Is quote-only evidence enough?");
  });
});
