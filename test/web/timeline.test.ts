import { describe, expect, it } from "vitest";

import { renderTimelineHtml } from "../../src/web/timeline.js";

describe("renderTimelineHtml", () => {
  it("embeds snapshot data without an external runtime", () => {
    const html = renderTimelineHtml({
      decisions: [
        {
          id: "dec_test",
          title: "Use static HTML",
          decision: "Generate one self-contained file.",
          tags: ["web"],
          status: "active",
          createdAt: "2026-07-17T00:00:00.000Z",
        },
      ],
      tasks: [],
    });

    expect(html).toContain("Use static HTML");
    expect(html).not.toContain("<script src=");
  });
});
