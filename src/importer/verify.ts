import type {
  Evidence,
  EvidenceCandidate,
  ImportDecision,
  ImportDelta,
  ImportGlossary,
  ImportQuestion,
  ImportSpecChange,
  ImportTask,
  NormalizedChat,
  StoreDigest,
} from "../contract/types.js";

type WithVerifiedEvidence<T> = Omit<T, "evidence"> & { evidence: Evidence };

export interface VerifiedImportDelta {
  summary: string;
  decisions: Array<WithVerifiedEvidence<ImportDecision>>;
  tasks: Array<WithVerifiedEvidence<ImportTask>>;
  questions: Array<WithVerifiedEvidence<ImportQuestion>>;
  glossary: Array<WithVerifiedEvidence<ImportGlossary>>;
  specChanges: Array<WithVerifiedEvidence<ImportSpecChange>>;
}

function verifyEvidence(candidate: EvidenceCandidate, chat: NormalizedChat): Evidence {
  const turn = chat.turns.find(({ index }) => index === candidate.turnIndex);
  if (turn === undefined) {
    throw new Error(`Evidence cites missing turn ${candidate.turnIndex}.`);
  }

  const firstIndex = turn.text.indexOf(candidate.quote);
  if (firstIndex === -1) {
    throw new Error(`Evidence quote is absent from turn ${candidate.turnIndex}.`);
  }

  if (turn.text.indexOf(candidate.quote, firstIndex + 1) !== -1) {
    throw new Error(
      `Evidence quote occurs more than once in turn ${candidate.turnIndex}.`,
    );
  }

  return {
    sourceId: chat.id,
    turnIndex: turn.index,
    role: turn.role,
    quote: candidate.quote,
    startChar: firstIndex,
    endChar: firstIndex + candidate.quote.length,
  };
}

function withVerifiedEvidence<T extends { evidence: EvidenceCandidate }>(
  items: T[],
  chat: NormalizedChat,
): Array<WithVerifiedEvidence<T>> {
  return items.map(({ evidence, ...item }) => ({
    ...item,
    evidence: verifyEvidence(evidence, chat),
  }));
}

export function verifyImportDelta(
  candidate: ImportDelta,
  chat: NormalizedChat,
  digest: StoreDigest,
): VerifiedImportDelta {
  const activeDecisionIds = new Set(digest.activeDecisions.map(({ id }) => id));
  for (const decision of candidate.decisions) {
    if (decision.supersedes !== null && !activeDecisionIds.has(decision.supersedes)) {
      throw new Error(
        `Decision cannot supersede ${decision.supersedes}: it is not an active decision.`,
      );
    }
  }

  return {
    summary: candidate.summary,
    decisions: withVerifiedEvidence(candidate.decisions, chat),
    tasks: withVerifiedEvidence(candidate.tasks, chat),
    questions: withVerifiedEvidence(candidate.questions, chat),
    glossary: withVerifiedEvidence(candidate.glossary, chat),
    specChanges: withVerifiedEvidence(candidate.specChanges, chat),
  };
}
