import { createInterface } from "node:readline/promises";

import {
  filterProposalSelection,
  formatKeyedProposal,
  parseProposalSelection,
  proposalItems,
} from "./proposal.js";
import type { VerifiedImportDelta } from "./verify.js";

export type ReviewInput = NodeJS.ReadableStream & { isTTY?: boolean };
export type ReviewOutput = NodeJS.WritableStream & { isTTY?: boolean };

export type ReviewPrompt = (question: string) => Promise<string>;

export interface ReviewImportOptions {
  input: ReviewInput;
  output: ReviewOutput;
  prompt?: ReviewPrompt;
}

/** The original TTY-review shape deliberately omits UI-only item kinds. */
export interface ReviewItem {
  key: string;
  label: string;
  evidenceQuote: string;
}

export function reviewItems(delta: VerifiedImportDelta): ReviewItem[] {
  return proposalItems(delta).map(({ key, label, evidenceQuote }) => ({
    key,
    label,
    evidenceQuote,
  }));
}
export const formatReviewProposal = formatKeyedProposal;
export const parseReviewSelection = parseProposalSelection;
export const filterReviewSelection = filterProposalSelection;

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
