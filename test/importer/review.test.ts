import { describe, expect, it } from "vitest";

import type { VerifiedImportDelta } from "../../src/importer/verify.js";
import {
  assertReviewTty,
  filterReviewSelection,
  formatReviewProposal,
  parseReviewSelection,
  reviewImport,
  reviewItems,
  type ReviewInput,
  type ReviewOutput,
  type ReviewPrompt,
} from "../../src/importer/review.js";

const evidence = {
  sourceId: "src_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  turnIndex: 0,
  role: "user" as const,
  quote: "Supported by the normalized transcript.",
  startChar: 0,
  endChar: 38,
};

const proposal: VerifiedImportDelta = {
  summary: "All item types are available for review.",
  decisions: [
    {
      title: "Use a plain-file store",
      context: "Context",
      decision: "Use Markdown files",
      rationale: "Git-friendly",
      alternatives: ["Use a database"],
      supersedes: null,
      tags: ["store"],
      evidence,
    },
  ],
  tasks: [
    {
      title: "Add review tests",
      detail: null,
      evidence,
    },
  ],
  questions: [
    {
      question: "Should the review be interactive?",
      evidence,
    },
  ],
  glossary: [
    {
      term: "Provenance",
      definition: "Exact supporting chat text",
      evidence,
    },
  ],
  specChanges: [
    {
      section: "Import workflow",
      operation: "add",
      content: "Support review selection.",
      evidence,
    },
  ],
};

function terminal(isTTY = true): {
  input: ReviewInput;
  output: ReviewOutput;
  text: () => string;
} {
  let written = "";
  return {
    input: { isTTY } as ReviewInput,
    output: {
      isTTY,
      write: (chunk: string) => {
        written += chunk;
        return true;
      },
    } as ReviewOutput,
    text: () => written,
  };
}

function scriptedPrompt(answers: string[]): {
  prompt: ReviewPrompt;
  questions: string[];
} {
  const questions: string[] = [];
  return {
    prompt: async (question) => {
      questions.push(question);
      return answers.shift() ?? "";
    },
    questions,
  };
}

describe("import review", () => {
  it("assigns stable, category-local keys in the fixed import order", () => {
    expect(reviewItems(proposal)).toEqual([
      {
        key: "d1",
        label: "Use a plain-file store",
        evidenceQuote: evidence.quote,
      },
      { key: "t1", label: "Add review tests", evidenceQuote: evidence.quote },
      {
        key: "q1",
        label: "Should the review be interactive?",
        evidenceQuote: evidence.quote,
      },
      { key: "g1", label: "Provenance", evidenceQuote: evidence.quote },
      {
        key: "s1",
        label: "Import workflow",
        evidenceQuote: evidence.quote,
      },
    ]);

    const formatted = formatReviewProposal(proposal);
    expect(formatted).toContain("- [d1] Use a plain-file store");
    expect(formatted).toContain("- [t1] Add review tests");
    expect(formatted).toContain("- [q1] Should the review be interactive?");
    expect(formatted).toContain("- [g1] Provenance");
    expect(formatted).toContain("- [s1] Import workflow");
    expect(formatted.indexOf("[d1]")).toBeLessThan(formatted.indexOf("[t1]"));
    expect(formatted.indexOf("[t1]")).toBeLessThan(formatted.indexOf("[q1]"));
    expect(formatted.indexOf("[q1]")).toBeLessThan(formatted.indexOf("[g1]"));
    expect(formatted.indexOf("[g1]")).toBeLessThan(formatted.indexOf("[s1]"));
  });

  it("parses trimmed lowercase keys, deduplicates them, and filters the same delta", () => {
    const selected = parseReviewSelection(proposal, " t1, d1, t1 , s1 ");
    expect(selected).toEqual(["t1", "d1", "s1"]);

    const filtered = filterReviewSelection(proposal, selected);
    expect(filtered.summary).toBe(proposal.summary);
    expect(filtered.decisions).toEqual(proposal.decisions);
    expect(filtered.tasks).toEqual(proposal.tasks);
    expect(filtered.questions).toEqual([]);
    expect(filtered.glossary).toEqual([]);
    expect(filtered.specChanges).toEqual(proposal.specChanges);
  });

  it("rejects malformed and unknown selection keys", () => {
    expect(() => parseReviewSelection(proposal, "D1")).toThrow(
      'Invalid review selection key: "D1".',
    );
    expect(() => parseReviewSelection(proposal, "d1,,t1")).toThrow(
      'Invalid review selection key: "".',
    );
    expect(() => parseReviewSelection(proposal, "d2")).toThrow(
      "Unknown review selection key: d2.",
    );
  });

  it("requires both standard streams to be TTYs", () => {
    const interactive = terminal();
    expect(() => assertReviewTty(interactive.input, interactive.output)).not.toThrow();
    expect(() => assertReviewTty(terminal(false).input, interactive.output)).toThrow(
      "--review requires both stdin and stdout to be TTYs; a TTY is required for each.",
    );
    expect(() => assertReviewTty(interactive.input, terminal(false).output)).toThrow(
      "--review requires both stdin and stdout to be TTYs; a TTY is required for each.",
    );
  });

  it("returns no selection for blank input without asking for confirmation", async () => {
    const io = terminal();
    const scripted = scriptedPrompt(["   "]);

    await expect(
      reviewImport(proposal, { ...io, prompt: scripted.prompt }),
    ).resolves.toBeUndefined();
    expect(scripted.questions).toEqual([
      "Select items to apply (comma-separated keys): ",
    ]);
    expect(io.text()).toContain("No items were selected. Nothing was written.");
  });

  it("returns only confirmed selections and asks the exact final prompt", async () => {
    const io = terminal();
    const scripted = scriptedPrompt(["d1, t1, q1, g1, s1", "YES"]);

    const selected = await reviewImport(proposal, { ...io, prompt: scripted.prompt });

    expect(selected).toEqual(proposal);
    expect(scripted.questions).toEqual([
      "Select items to apply (comma-separated keys): ",
      "Apply 5 selected items? [y/N]",
    ]);
  });

  it("does not approve a rejected confirmation", async () => {
    const io = terminal();
    const scripted = scriptedPrompt(["d1", "no"]);

    await expect(
      reviewImport(proposal, { ...io, prompt: scripted.prompt }),
    ).resolves.toBeUndefined();
    expect(io.text()).toContain("Selection was not applied. Nothing was written.");
  });

  it("treats an empty proposal as a successful no-write review", async () => {
    const io = terminal();
    const scripted = scriptedPrompt([]);
    const emptyProposal: VerifiedImportDelta = {
      ...proposal,
      decisions: [],
      tasks: [],
      questions: [],
      glossary: [],
      specChanges: [],
    };

    await expect(
      reviewImport(emptyProposal, { ...io, prompt: scripted.prompt }),
    ).resolves.toBeUndefined();
    expect(scripted.questions).toEqual([]);
    expect(io.text()).toContain("No items were extracted. Nothing was written.");
  });

  it("rejects non-TTY interactive review before prompting", async () => {
    const io = terminal(false);
    const scripted = scriptedPrompt(["d1"]);

    await expect(
      reviewImport(proposal, { ...io, prompt: scripted.prompt }),
    ).rejects.toThrow(
      "--review requires both stdin and stdout to be TTYs; a TTY is required for each.",
    );
    expect(scripted.questions).toEqual([]);
    expect(io.text()).toBe("");
  });
});
