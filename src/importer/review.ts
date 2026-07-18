import { createInterface } from "node:readline/promises";

import type { VerifiedImportDelta } from "./verify.js";

export type ReviewInput = NodeJS.ReadableStream & { isTTY?: boolean };
export type ReviewOutput = NodeJS.WritableStream & { isTTY?: boolean };

export type ReviewPrompt = (question: string) => Promise<string>;

export interface ReviewImportOptions {
  input: ReviewInput;
  output: ReviewOutput;
  prompt?: ReviewPrompt;
}

export interface ReviewItem {
  key: string;
  label: string;
  evidenceQuote: string;
}

interface ReviewCategory {
  prefix: "d" | "t" | "q" | "g" | "s";
  name: string;
  items: Array<{ evidence: { quote: string } } & Record<string, unknown>>;
  label: (item: Record<string, unknown>) => string;
}

function reviewCategories(delta: VerifiedImportDelta): ReviewCategory[] {
  return [
    {
      prefix: "d",
      name: "Decisions",
      items: delta.decisions,
      label: (item) => item.title as string,
    },
    {
      prefix: "t",
      name: "Tasks",
      items: delta.tasks,
      label: (item) => item.title as string,
    },
    {
      prefix: "q",
      name: "Questions",
      items: delta.questions,
      label: (item) => item.question as string,
    },
    {
      prefix: "g",
      name: "Glossary",
      items: delta.glossary,
      label: (item) => item.term as string,
    },
    {
      prefix: "s",
      name: "Spec changes",
      items: delta.specChanges,
      label: (item) => item.section as string,
    },
  ];
}

export function reviewItems(delta: VerifiedImportDelta): ReviewItem[] {
  return reviewCategories(delta).flatMap(({ prefix, items, label }) =>
    items.map((item, index) => ({
      key: `${prefix}${index + 1}`,
      label: label(item),
      evidenceQuote: item.evidence.quote,
    })),
  );
}

export function formatReviewProposal(delta: VerifiedImportDelta): string {
  const lines = ["Review proposal", "", delta.summary];

  for (const { prefix, name, items, label } of reviewCategories(delta)) {
    lines.push("", `${name}: ${items.length}`);
    for (const [index, item] of items.entries()) {
      lines.push(
        `- [${prefix}${index + 1}] ${label(item)}`,
        `  Evidence: \u201c${item.evidence.quote}\u201d`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function parseReviewSelection(
  delta: VerifiedImportDelta,
  selection: string,
): string[] {
  if (selection.trim() === "") {
    return [];
  }

  const knownKeys = new Set(reviewItems(delta).map(({ key }) => key));
  const selectedKeys: string[] = [];
  const seenKeys = new Set<string>();

  for (const rawKey of selection.split(",")) {
    const key = rawKey.trim();
    if (!/^[dtqgs][1-9][0-9]*$/.test(key)) {
      throw new Error(`Invalid review selection key: ${JSON.stringify(key)}.`);
    }
    if (!knownKeys.has(key)) {
      throw new Error(`Unknown review selection key: ${key}.`);
    }
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      selectedKeys.push(key);
    }
  }

  return selectedKeys;
}

export function filterReviewSelection(
  delta: VerifiedImportDelta,
  selectedKeys: readonly string[],
): VerifiedImportDelta {
  const selected = new Set(selectedKeys);

  return {
    ...delta,
    decisions: delta.decisions.filter((_item, index) => selected.has(`d${index + 1}`)),
    tasks: delta.tasks.filter((_item, index) => selected.has(`t${index + 1}`)),
    questions: delta.questions.filter((_item, index) => selected.has(`q${index + 1}`)),
    glossary: delta.glossary.filter((_item, index) => selected.has(`g${index + 1}`)),
    specChanges: delta.specChanges.filter((_item, index) =>
      selected.has(`s${index + 1}`),
    ),
  };
}

export function assertReviewTty(
  input: Pick<ReviewInput, "isTTY">,
  output: Pick<ReviewOutput, "isTTY">,
): void {
  if (input.isTTY !== true || output.isTTY !== true) {
    throw new Error(
      "--review requires both stdin and stdout to be TTYs; a TTY is required for each.",
    );
  }
}

function createDefaultPrompt(
  input: ReviewInput,
  output: ReviewOutput,
): { prompt: ReviewPrompt; close: () => void } {
  const readline = createInterface({ input, output });
  return {
    prompt: (question) => readline.question(question),
    close: () => readline.close(),
  };
}

export async function reviewImport(
  delta: VerifiedImportDelta,
  options: ReviewImportOptions,
): Promise<VerifiedImportDelta | undefined> {
  assertReviewTty(options.input, options.output);
  options.output.write(formatReviewProposal(delta));

  if (reviewItems(delta).length === 0) {
    options.output.write("No items were extracted. Nothing was written.\n");
    return undefined;
  }

  const defaultPrompt =
    options.prompt === undefined
      ? createDefaultPrompt(options.input, options.output)
      : undefined;
  const prompt = options.prompt ?? defaultPrompt?.prompt;

  try {
    if (prompt === undefined) {
      throw new Error("Unable to start interactive review.");
    }

    const selectedKeys = parseReviewSelection(
      delta,
      await prompt("Select items to apply (comma-separated keys): "),
    );
    if (selectedKeys.length === 0) {
      options.output.write("No items were selected. Nothing was written.\n");
      return undefined;
    }

    const selectedDelta = filterReviewSelection(delta, selectedKeys);
    const confirmation = await prompt(
      `Apply ${reviewItems(selectedDelta).length} selected items? [y/N]`,
    );
    if (!/^(y|yes)$/i.test(confirmation.trim())) {
      options.output.write("Selection was not applied. Nothing was written.\n");
      return undefined;
    }

    return selectedDelta;
  } finally {
    defaultPrompt?.close();
  }
}
