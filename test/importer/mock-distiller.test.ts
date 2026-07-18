import { describe, expect, it } from "vitest";

import { parseGenericMarkdown } from "../../src/importer/generic.js";
import { distillWithMock } from "../../src/importer/mock-distiller.js";

describe("distillWithMock", () => {
  it("extracts explicit add and revise spec markers with exact evidence", () => {
    const { chat } = parseGenericMarkdown(
      `# Spec markers

## User

Spec: add | Demo store | Include deterministic records.
Spec: revise | Import workflow | Preserve verified evidence in every record.`,
      "spec-markers.md",
    );

    const delta = distillWithMock(chat);

    expect(delta.specChanges).toEqual([
      {
        section: "Demo store",
        operation: "add",
        content: "Include deterministic records.",
        evidence: {
          turnIndex: 0,
          quote: "Spec: add | Demo store | Include deterministic records.",
        },
      },
      {
        section: "Import workflow",
        operation: "revise",
        content: "Preserve verified evidence in every record.",
        evidence: {
          turnIndex: 0,
          quote:
            "Spec: revise | Import workflow | Preserve verified evidence in every record.",
        },
      },
    ]);
  });

  it("ignores malformed and unsupported spec markers", () => {
    const { chat } = parseGenericMarkdown(
      `## User

Spec: delete | Demo store | Remove this.
Spec: add | Missing content
Spec: revise |  | Missing section
Spec: add | Demo store |`,
      "invalid-spec-markers.md",
    );

    expect(distillWithMock(chat).specChanges).toEqual([]);
  });
});
