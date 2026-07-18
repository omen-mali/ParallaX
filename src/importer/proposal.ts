import type { VerifiedImportDelta } from "./verify.js";

export type ProposalItemKind =
  "decision" | "task" | "question" | "glossary" | "spec-change";

export interface ProposalItem {
  key: string;
  kind: ProposalItemKind;
  label: string;
  evidenceQuote: string;
}

interface ProposalCategory {
  prefix: "d" | "t" | "q" | "g" | "s";
  kind: ProposalItemKind;
  name: string;
  items: Array<{ evidence: { quote: string } } & Record<string, unknown>>;
  label: (item: Record<string, unknown>) => string;
}

export function proposalCategories(delta: VerifiedImportDelta): ProposalCategory[] {
  return [
    {
      prefix: "d",
      kind: "decision",
      name: "Decisions",
      items: delta.decisions,
      label: (item) => item.title as string,
    },
    {
      prefix: "t",
      kind: "task",
      name: "Tasks",
      items: delta.tasks,
      label: (item) => item.title as string,
    },
    {
      prefix: "q",
      kind: "question",
      name: "Questions",
      items: delta.questions,
      label: (item) => item.question as string,
    },
    {
      prefix: "g",
      kind: "glossary",
      name: "Glossary",
      items: delta.glossary,
      label: (item) => item.term as string,
    },
    {
      prefix: "s",
      kind: "spec-change",
      name: "Spec changes",
      items: delta.specChanges,
      label: (item) => item.section as string,
    },
  ];
}

export function proposalItems(delta: VerifiedImportDelta): ProposalItem[] {
  return proposalCategories(delta).flatMap(({ prefix, kind, items, label }) =>
    items.map((item, index) => ({
      key: `${prefix}${index + 1}`,
      kind,
      label: label(item),
      evidenceQuote: item.evidence.quote,
    })),
  );
}

export function formatKeyedProposal(delta: VerifiedImportDelta): string {
  const lines = ["Review proposal", "", delta.summary];

  for (const { prefix, name, items, label } of proposalCategories(delta)) {
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

function knownProposalKeys(delta: VerifiedImportDelta): Set<string> {
  return new Set(proposalItems(delta).map(({ key }) => key));
}

export function validateProposalKeys(
  delta: VerifiedImportDelta,
  keys: readonly string[],
): string[] {
  const knownKeys = knownProposalKeys(delta);
  const selectedKeys: string[] = [];
  const seenKeys = new Set<string>();

  for (const key of keys) {
    if (!/^[dtqgs][1-9][0-9]*$/.test(key)) {
      throw new Error(`Invalid review selection key: ${JSON.stringify(key)}.`);
    }
    if (!knownKeys.has(key)) {
      throw new Error(`Unknown review selection key: ${key}.`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate review selection key: ${key}.`);
    }
    seenKeys.add(key);
    selectedKeys.push(key);
  }

  return selectedKeys;
}

export function parseProposalSelection(
  delta: VerifiedImportDelta,
  selection: string,
): string[] {
  if (selection.trim() === "") {
    return [];
  }

  const parsed = selection.split(",").map((key) => key.trim());
  const knownKeys = knownProposalKeys(delta);
  const selectedKeys: string[] = [];
  const seenKeys = new Set<string>();

  for (const key of parsed) {
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

export function filterProposalSelection(
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

/**
 * Reconstruct keys from a delta returned by the TTY reviewer. Its category
 * filters preserve item identity, so this remains exact even when labels match.
 */
export function selectionKeysForFilteredDelta(
  source: VerifiedImportDelta,
  selected: VerifiedImportDelta,
): string[] {
  const selectedItems = new Set<object>([
    ...selected.decisions,
    ...selected.tasks,
    ...selected.questions,
    ...selected.glossary,
    ...selected.specChanges,
  ]);

  return proposalCategories(source).flatMap(({ prefix, items }) =>
    items.flatMap((item, index) =>
      selectedItems.has(item) ? [`${prefix}${index + 1}`] : [],
    ),
  );
}
