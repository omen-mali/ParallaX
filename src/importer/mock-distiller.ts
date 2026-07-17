import type {
  EvidenceCandidate,
  ImportDelta,
  NormalizedChat,
  StoreDigest,
} from "../contract/types.js";
import type { Distiller, DistillOptions } from "./distiller.js";

const markerPattern = /^(Decision|Task|Question|Term):\s*(.+)$/gim;

function evidence(turnIndex: number, quote: string): EvidenceCandidate {
  return { turnIndex, quote };
}

/**
 * A deterministic stand-in for the model. It intentionally extracts only
 * explicit line-level markers so mock mode never invents project context.
 */
export function distillWithMock(chat: NormalizedChat): ImportDelta {
  const delta: ImportDelta = {
    summary: "Mock proposal from explicit Decision, Task, Question, and Term markers.",
    decisions: [],
    tasks: [],
    questions: [],
    glossary: [],
    specChanges: [],
  };

  for (const turn of chat.turns) {
    for (const match of turn.text.matchAll(markerPattern)) {
      const kind = match[1]?.toLowerCase();
      const value = match[2]?.trim();
      const quote = match[0];

      if (kind === undefined || value === undefined || value.length === 0) {
        continue;
      }

      const candidateEvidence = evidence(turn.index, quote);
      if (kind === "decision") {
        delta.decisions.push({
          title: value,
          context: "Explicitly marked in the imported chat.",
          decision: value,
          rationale: "The source chat labels this as a decision.",
          alternatives: [],
          supersedes: null,
          tags: ["imported"],
          evidence: candidateEvidence,
        });
      } else if (kind === "task") {
        delta.tasks.push({
          title: value,
          detail: null,
          evidence: candidateEvidence,
        });
      } else if (kind === "question") {
        delta.questions.push({
          question: value,
          evidence: candidateEvidence,
        });
      } else if (kind === "term") {
        const [term, ...definitionParts] = value.split(/\s+-\s+|:\s+/);
        const definition = definitionParts.join(" - ").trim();
        if (term !== undefined && definition.length > 0) {
          delta.glossary.push({
            term,
            definition,
            evidence: candidateEvidence,
          });
        }
      }
    }
  }

  return delta;
}

export class MockDistiller implements Distiller {
  readonly provider = "mock" as const;

  async distill(
    chat: NormalizedChat,
    _digest: StoreDigest,
    _options: DistillOptions,
  ): Promise<ImportDelta> {
    return distillWithMock(chat);
  }
}
