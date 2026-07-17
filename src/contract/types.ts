import { z } from "zod";

export const STORE_SCHEMA_VERSION = 1 as const;

const TextSchema = z.string().min(1);
const NullableTextSchema = z.string().nullable();
const TimestampSchema = z.string().datetime({ offset: true });
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const recordId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[a-z0-9][a-z0-9_-]{2,127}$`));

export const SourceIdSchema = z.string().regex(/^src_[a-f0-9]{64}$/);
export const DecisionIdSchema = recordId("dec");
export const TaskIdSchema = recordId("task");
export const QuestionIdSchema = recordId("question");
export const GlossaryIdSchema = recordId("term");
export const SpecChangeIdSchema = recordId("spec");

export const ChatSourceSchema = z.enum(["chatgpt", "claude", "generic"]);
export const ChatRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "tool",
  "unknown",
]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const TagSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

export const ChatTurnSchema = z
  .object({
    index: z.number().int().nonnegative(),
    role: ChatRoleSchema,
    text: TextSchema,
  })
  .strict();

export const NormalizedChatSchema = z
  .object({
    schemaVersion: z.literal(STORE_SCHEMA_VERSION),
    id: SourceIdSchema,
    source: ChatSourceSchema,
    title: NullableTextSchema,
    turns: z.array(ChatTurnSchema).min(1),
  })
  .strict();

export type NormalizedChat = z.infer<typeof NormalizedChatSchema>;

export const EvidenceCandidateSchema = z
  .object({
    turnIndex: z.number().int().nonnegative(),
    quote: TextSchema,
  })
  .strict();

export type EvidenceCandidate = z.infer<typeof EvidenceCandidateSchema>;

export const ImportDecisionSchema = z
  .object({
    title: TextSchema,
    context: TextSchema,
    decision: TextSchema,
    rationale: TextSchema,
    alternatives: z.array(TextSchema),
    supersedes: DecisionIdSchema.nullable(),
    tags: z.array(TagSchema),
    evidence: EvidenceCandidateSchema,
  })
  .strict();

export const ImportTaskSchema = z
  .object({
    title: TextSchema,
    detail: NullableTextSchema,
    evidence: EvidenceCandidateSchema,
  })
  .strict();

export const ImportQuestionSchema = z
  .object({
    question: TextSchema,
    evidence: EvidenceCandidateSchema,
  })
  .strict();

export const ImportGlossarySchema = z
  .object({
    term: TextSchema,
    definition: TextSchema,
    evidence: EvidenceCandidateSchema,
  })
  .strict();

export const SpecChangeOperationSchema = z.enum(["add", "revise"]);

export const ImportSpecChangeSchema = z
  .object({
    section: TextSchema,
    operation: SpecChangeOperationSchema,
    content: TextSchema,
    evidence: EvidenceCandidateSchema,
  })
  .strict();

/**
 * This is the only schema passed to zodTextFormat(). It intentionally contains
 * neither optional fields nor locally-created lifecycle data.
 */
export const ImportDeltaSchema = z
  .object({
    summary: TextSchema,
    decisions: z.array(ImportDecisionSchema),
    tasks: z.array(ImportTaskSchema),
    questions: z.array(ImportQuestionSchema),
    glossary: z.array(ImportGlossarySchema),
    specChanges: z.array(ImportSpecChangeSchema),
  })
  .strict();

export type ImportDelta = z.infer<typeof ImportDeltaSchema>;
export type ImportDecision = z.infer<typeof ImportDecisionSchema>;
export type ImportTask = z.infer<typeof ImportTaskSchema>;
export type ImportQuestion = z.infer<typeof ImportQuestionSchema>;
export type ImportGlossary = z.infer<typeof ImportGlossarySchema>;
export type ImportSpecChange = z.infer<typeof ImportSpecChangeSchema>;

export const EvidenceSchema = z
  .object({
    sourceId: SourceIdSchema,
    turnIndex: z.number().int().nonnegative(),
    role: ChatRoleSchema,
    quote: TextSchema,
    startChar: z.number().int().nonnegative(),
    endChar: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    ({ quote, startChar, endChar }) => endChar - startChar === quote.length,
    "Evidence span must match quote length",
  );

export const SourceRecordSchema = z
  .object({
    schemaVersion: z.literal(STORE_SCHEMA_VERSION),
    kind: z.literal("source"),
    id: SourceIdSchema,
    source: ChatSourceSchema,
    title: NullableTextSchema,
    rawHash: HashSchema,
    canonicalHash: HashSchema,
    importedAt: TimestampSchema,
    turnCount: z.number().int().nonnegative(),
    metadataOnly: z.boolean().optional(),
  })
  .strict();

const StoredFields = {
  schemaVersion: z.literal(STORE_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  evidence: EvidenceSchema,
};

export const DecisionRecordSchema = z
  .object({
    ...StoredFields,
    kind: z.literal("decision"),
    id: DecisionIdSchema,
    status: z.enum(["active", "superseded"]),
    title: TextSchema,
    context: TextSchema,
    decision: TextSchema,
    rationale: TextSchema,
    alternatives: z.array(TextSchema),
    tags: z.array(TagSchema),
    supersedes: DecisionIdSchema.optional(),
  })
  .strict();

export const TaskRecordSchema = z
  .object({
    ...StoredFields,
    kind: z.literal("task"),
    id: TaskIdSchema,
    status: z.enum(["open", "done"]),
    title: TextSchema,
    detail: z.string().optional(),
  })
  .strict();

export const QuestionRecordSchema = z
  .object({
    ...StoredFields,
    kind: z.literal("question"),
    id: QuestionIdSchema,
    status: z.enum(["open", "resolved"]),
    question: TextSchema,
    resolution: z.string().optional(),
  })
  .strict();

export const GlossaryRecordSchema = z
  .object({
    ...StoredFields,
    kind: z.literal("glossary"),
    id: GlossaryIdSchema,
    term: TextSchema,
    definition: TextSchema,
  })
  .strict();

export const SpecChangeRecordSchema = z
  .object({
    ...StoredFields,
    kind: z.literal("spec-change"),
    id: SpecChangeIdSchema,
    section: TextSchema,
    operation: SpecChangeOperationSchema,
    content: TextSchema,
  })
  .strict();

export const StoreRecordSchema = z.discriminatedUnion("kind", [
  SourceRecordSchema,
  DecisionRecordSchema,
  TaskRecordSchema,
  QuestionRecordSchema,
  GlossaryRecordSchema,
  SpecChangeRecordSchema,
]);

export const StoreDigestSchema = z
  .object({
    activeDecisions: z.array(
      z
        .object({
          id: DecisionIdSchema,
          title: TextSchema,
          decision: TextSchema,
          tags: z.array(TagSchema),
        })
        .strict(),
    ),
    openTasks: z.array(z.object({ id: TaskIdSchema, title: TextSchema }).strict()),
    openQuestions: z.array(
      z.object({ id: QuestionIdSchema, question: TextSchema }).strict(),
    ),
    omittedRecordCount: z.number().int().nonnegative(),
  })
  .strict();

export type Evidence = z.infer<typeof EvidenceSchema>;
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
export type TaskRecord = z.infer<typeof TaskRecordSchema>;
export type StoreRecord = z.infer<typeof StoreRecordSchema>;
export type StoreDigest = z.infer<typeof StoreDigestSchema>;
