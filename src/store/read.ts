import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

import {
  StoreDigestSchema,
  type ChatRole,
  type StoreDigest,
} from "../contract/types.js";
import { storePaths } from "./store.js";

export interface StoredEvidence {
  quote: string;
  quoteHash?: string;
  sourceId?: string;
  turnIndex?: number;
  role?: ChatRole;
  startChar?: number;
  endChar?: number;
}

export interface StoredDecision {
  id: string;
  title: string;
  decision: string;
  context: string;
  rationale: string;
  alternatives: string[];
  tags: string[];
  status: "active" | "superseded";
  createdAt: string;
  updatedAt: string;
  supersedes?: string;
  evidence: StoredEvidence;
}

export interface StoredTask {
  id: string;
  title: string;
  status: "open" | "done";
  detail?: string;
  createdAt?: string;
  updatedAt?: string;
  evidence: StoredEvidence;
}

export interface StoredQuestion {
  id: string;
  question: string;
  status: "open" | "resolved";
  createdAt?: string;
  updatedAt?: string;
  evidence: StoredEvidence;
}

export interface StoredGlossaryTerm {
  id: string;
  term: string;
  definition: string;
  createdAt?: string;
  updatedAt?: string;
  evidence: StoredEvidence;
}

export interface StoredSpecChange {
  id: string;
  section: string;
  operation: "add" | "revise";
  content: string;
  createdAt?: string;
  updatedAt?: string;
  evidence: StoredEvidence;
}

export interface StoredSourceMeta {
  id: string;
  title: string | null;
  metadataOnly: boolean;
  importedAt: string;
}

export interface StoreSnapshot {
  decisions: StoredDecision[];
  tasks: StoredTask[];
  questions: StoredQuestion[];
  glossary: StoredGlossaryTerm[];
  specChanges: StoredSpecChange[];
  sources: StoredSourceMeta[];
  omittedRecordCount: number;
}

function splitFrontMatter(contents: string): {
  metadata: Record<string, unknown>;
  body: string;
} {
  const match = contents.match(/^---\n([\s\S]*?)---\n([\s\S]*)$/);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error("Expected valid YAML front matter.");
  }
  const metadata = parse(match[1]);
  if (metadata === null || typeof metadata !== "object") {
    throw new Error("Expected front matter to be an object.");
  }
  return { metadata: metadata as Record<string, unknown>, body: match[2] };
}

function heading(body: string, name: string): string | undefined {
  const match = body.match(
    new RegExp(`^## ${name}\\n\\n([\\s\\S]*?)(?=\\n## |$)`, "m"),
  );
  return match?.[1]?.trim();
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${field} to be a string.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isChatRole(value: unknown): value is ChatRole {
  return (
    value === "system" ||
    value === "user" ||
    value === "assistant" ||
    value === "tool" ||
    value === "unknown"
  );
}

function quoteHash(quote: string): string {
  return createHash("sha256").update(quote).digest("hex");
}

function legacyTaskEvidence(
  metadata: Record<string, unknown>,
  quote: string,
): StoredEvidence {
  const evidence: StoredEvidence = { quote };
  const sourceId = optionalString(metadata.sourceId);
  if (sourceId !== undefined) {
    evidence.sourceId = sourceId;
  }
  if (typeof metadata.turnIndex === "number" && Number.isInteger(metadata.turnIndex)) {
    evidence.turnIndex = metadata.turnIndex;
  }
  if (isChatRole(metadata.role)) {
    evidence.role = metadata.role;
  }
  if (typeof metadata.startChar === "number" && Number.isInteger(metadata.startChar)) {
    evidence.startChar = metadata.startChar;
  }
  if (typeof metadata.endChar === "number" && Number.isInteger(metadata.endChar)) {
    evidence.endChar = metadata.endChar;
  }
  const storedQuoteHash = optionalString(metadata.quoteHash);
  if (storedQuoteHash !== undefined) {
    evidence.quoteHash = storedQuoteHash;
  }
  return evidence;
}

function hasModernTaskProvenance(metadata: Record<string, unknown>): boolean {
  return ["role", "startChar", "endChar", "updatedAt"].some(
    (field) => field in metadata,
  );
}

function parseOwnedEvidence(
  metadata: Record<string, unknown>,
  quote: string,
): StoredEvidence | undefined {
  const provenanceFields = [
    "sourceId",
    "turnIndex",
    "role",
    "startChar",
    "endChar",
    "quoteHash",
  ];
  const hasStoredProvenance = provenanceFields.some((field) => field in metadata);
  if (!hasStoredProvenance) {
    return { quote };
  }

  const sourceId = optionalString(metadata.sourceId);
  const role = metadata.role;
  const quoteHashValue = optionalString(metadata.quoteHash);
  if (
    sourceId === undefined ||
    !/^src_[a-f0-9]{64}$/.test(sourceId) ||
    typeof metadata.turnIndex !== "number" ||
    !Number.isInteger(metadata.turnIndex) ||
    metadata.turnIndex < 0 ||
    !isChatRole(role) ||
    typeof metadata.startChar !== "number" ||
    !Number.isInteger(metadata.startChar) ||
    metadata.startChar < 0 ||
    typeof metadata.endChar !== "number" ||
    !Number.isInteger(metadata.endChar) ||
    metadata.endChar < metadata.startChar ||
    metadata.endChar - metadata.startChar !== quote.length ||
    quoteHashValue === undefined ||
    !/^[a-f0-9]{64}$/.test(quoteHashValue) ||
    quoteHashValue !== quoteHash(quote)
  ) {
    return undefined;
  }

  return {
    quote,
    quoteHash: quoteHashValue,
    sourceId,
    turnIndex: metadata.turnIndex,
    role,
    startChar: metadata.startChar,
    endChar: metadata.endChar,
  };
}

function parseDecisionEvidence(value: unknown): StoredEvidence {
  if (value === null || typeof value !== "object") {
    throw new Error("Expected decision evidence object.");
  }
  const evidence = value as Record<string, unknown>;
  const quote = stringValue(evidence.quote, "evidence.quote");
  const result: StoredEvidence = { quote };

  const sourceId = optionalString(evidence.sourceId);
  if (sourceId !== undefined) {
    result.sourceId = sourceId;
  }
  if (typeof evidence.turnIndex === "number" && Number.isInteger(evidence.turnIndex)) {
    result.turnIndex = evidence.turnIndex;
  }
  if (isChatRole(evidence.role)) {
    result.role = evidence.role;
  }
  if (typeof evidence.startChar === "number" && Number.isInteger(evidence.startChar)) {
    result.startChar = evidence.startChar;
  }
  if (typeof evidence.endChar === "number" && Number.isInteger(evidence.endChar)) {
    result.endChar = evidence.endChar;
  }
  return result;
}

function parseAlternatives(body: string, metadata: Record<string, unknown>): string[] {
  if (Array.isArray(metadata.alternatives)) {
    return metadata.alternatives.filter(
      (item): item is string => typeof item === "string",
    );
  }
  const section = heading(body, "Alternatives");
  if (section === undefined) {
    return [];
  }
  return section
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter((line) => line.length > 0 && line !== "None recorded");
}

async function readDecisions(storeRoot: string): Promise<StoredDecision[]> {
  const paths = storePaths(storeRoot);
  let entries: string[];
  try {
    entries = await readdir(paths.decisions);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const decisions = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".md"))
      .sort()
      .map(async (entry) => {
        const { metadata, body } = splitFrontMatter(
          await readFile(join(paths.decisions, entry), "utf8"),
        );
        const status = metadata.status;
        if (status !== "active" && status !== "superseded") {
          throw new Error(`Invalid decision status in ${entry}.`);
        }
        const validatedStatus: StoredDecision["status"] = status;
        const title = body.match(/^# (.+)$/m)?.[1];
        const decision = heading(body, "Decision");
        const context =
          optionalString(metadata.context) ?? heading(body, "Context") ?? "";
        const rationale =
          optionalString(metadata.rationale) ?? heading(body, "Rationale") ?? "";
        if (title === undefined || decision === undefined) {
          throw new Error(`Invalid decision body in ${entry}.`);
        }
        const tags = Array.isArray(metadata.tags)
          ? metadata.tags.filter((tag): tag is string => typeof tag === "string")
          : [];
        const supersedes = optionalString(metadata.supersedes);
        const createdAt = stringValue(metadata.createdAt, "createdAt");
        const updatedAt = optionalString(metadata.updatedAt) ?? createdAt;
        return {
          id: stringValue(metadata.id, "id"),
          title,
          decision,
          context,
          rationale,
          alternatives: parseAlternatives(body, metadata),
          tags,
          status: validatedStatus,
          createdAt,
          updatedAt,
          ...(supersedes === undefined ? {} : { supersedes }),
          evidence: parseDecisionEvidence(metadata.evidence),
        };
      }),
  );

  return decisions.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function extractBlockquote(body: string): string | undefined {
  const match = body.match(/^>\s?(.*)$/m);
  const quote = match?.[1];
  return quote !== undefined && quote.trim().length > 0 ? quote : undefined;
}

function parseTaskBlock(
  metadataRaw: string,
  checkbox: string,
  title: string,
  remainder: string,
): StoredTask | undefined {
  try {
    const metadata = parse(metadataRaw);
    if (metadata === null || typeof metadata !== "object") {
      return undefined;
    }
    const meta = metadata as Record<string, unknown>;
    const id = optionalString(meta.id);
    if (id === undefined || title.trim().length === 0) {
      return undefined;
    }

    const quote = extractBlockquote(remainder);
    if (quote === undefined || quote.length === 0) {
      return undefined;
    }

    const detailMatch = remainder.match(/^\n(?:\n)?  (.+?)(?:\n\n> |\n> )/s);
    const detail = detailMatch?.[1]?.trim();
    const evidence = hasModernTaskProvenance(meta)
      ? parseOwnedEvidence(meta, quote)
      : legacyTaskEvidence(meta, quote);
    if (evidence === undefined) {
      return undefined;
    }
    const createdAt = optionalString(meta.createdAt);
    const updatedAt = optionalString(meta.updatedAt);

    return {
      id,
      title: title.trim(),
      status: checkbox === "x" ? "done" : "open",
      ...(detail === undefined || detail.length === 0 ? {} : { detail }),
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      evidence,
    };
  } catch {
    return undefined;
  }
}

async function readTasks(
  storeRoot: string,
): Promise<{ tasks: StoredTask[]; omitted: number }> {
  let contents: string;
  try {
    contents = await readFile(storePaths(storeRoot).tasks, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { tasks: [], omitted: 0 };
    }
    throw error;
  }

  const taskPattern =
    /<!-- PARALLAX:TASK\n([\s\S]*?)\n-->\n- \[([ x])\] (.+?)(?:\n|$)([\s\S]*?)<!-- PARALLAX:TASK:END -->/g;
  const tasks: StoredTask[] = [];
  let omitted = 0;

  for (const match of contents.matchAll(taskPattern)) {
    const parsed = parseTaskBlock(
      match[1] ?? "",
      match[2] ?? " ",
      match[3] ?? "",
      match[4] ?? "",
    );
    if (parsed === undefined) {
      omitted += 1;
      continue;
    }
    tasks.push(parsed);
  }

  return { tasks, omitted };
}

function parseOwnedBlocks(
  contents: string,
  kind: "QUESTION" | "TERM" | "SPEC",
): {
  blocks: Array<{
    id: string;
    metadata: Record<string, unknown>;
    title: string;
    body: string;
    quote: string;
  }>;
  omitted: number;
} {
  const pattern = new RegExp(
    `<!-- PARALLAX:${kind}\\n([\\s\\S]*?)\\n-->\\n## (.+?)\\n\\n([\\s\\S]*?)\\n\\n> ([\\s\\S]*?)\\n<!-- PARALLAX:${kind}:END -->`,
    "g",
  );
  const blocks: Array<{
    id: string;
    metadata: Record<string, unknown>;
    title: string;
    body: string;
    quote: string;
  }> = [];
  let omitted = 0;

  for (const match of contents.matchAll(pattern)) {
    try {
      const parsedMetadata = parse(match[1] ?? "");
      if (parsedMetadata === null || typeof parsedMetadata !== "object") {
        omitted += 1;
        continue;
      }
      const metadata = parsedMetadata as Record<string, unknown>;
      const id = optionalString(metadata.id);
      const title = match[2]?.trim();
      const body = match[3]?.trim() ?? "";
      const quote = match[4];
      if (
        id === undefined ||
        id.length === 0 ||
        title === undefined ||
        title.length === 0 ||
        quote === undefined ||
        quote.trim().length === 0
      ) {
        omitted += 1;
        continue;
      }
      blocks.push({ id, metadata, title, body, quote });
    } catch {
      omitted += 1;
    }
  }

  // Count obvious start markers that did not produce a valid block.
  const startMarkers = [
    ...contents.matchAll(new RegExp(`<!-- PARALLAX:${kind}\\n`, "g")),
  ].length;
  if (startMarkers > blocks.length + omitted) {
    omitted += startMarkers - blocks.length - omitted;
  }

  return { blocks, omitted };
}

async function readOwnedFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readQuestions(
  storeRoot: string,
): Promise<{ questions: StoredQuestion[]; omitted: number }> {
  const contents = await readOwnedFile(storePaths(storeRoot).questions);
  if (contents === undefined) {
    return { questions: [], omitted: 0 };
  }

  const { blocks, omitted } = parseOwnedBlocks(contents, "QUESTION");
  const questions: StoredQuestion[] = [];
  let extraOmitted = 0;

  for (const block of blocks) {
    const statusMatch = block.body.match(/^Status:\s*(open|resolved)\s*$/im);
    const evidence = parseOwnedEvidence(block.metadata, block.quote);
    if (statusMatch?.[1] === undefined || evidence === undefined) {
      extraOmitted += 1;
      continue;
    }
    const createdAt = optionalString(block.metadata.createdAt);
    const updatedAt = optionalString(block.metadata.updatedAt);
    questions.push({
      id: block.id,
      question: block.title,
      status: statusMatch[1] as "open" | "resolved",
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      evidence,
    });
  }

  return { questions, omitted: omitted + extraOmitted };
}

async function readGlossary(
  storeRoot: string,
): Promise<{ glossary: StoredGlossaryTerm[]; omitted: number }> {
  const contents = await readOwnedFile(storePaths(storeRoot).glossary);
  if (contents === undefined) {
    return { glossary: [], omitted: 0 };
  }

  const { blocks, omitted } = parseOwnedBlocks(contents, "TERM");
  let extraOmitted = 0;
  const glossary: StoredGlossaryTerm[] = [];
  for (const block of blocks) {
    const evidence = parseOwnedEvidence(block.metadata, block.quote);
    if (evidence === undefined) {
      extraOmitted += 1;
      continue;
    }
    const createdAt = optionalString(block.metadata.createdAt);
    const updatedAt = optionalString(block.metadata.updatedAt);
    glossary.push({
      id: block.id,
      term: block.title,
      definition: block.body,
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      evidence,
    });
  }
  return {
    glossary,
    omitted: omitted + extraOmitted,
  };
}

async function readSpecChanges(
  storeRoot: string,
): Promise<{ specChanges: StoredSpecChange[]; omitted: number }> {
  const contents = await readOwnedFile(storePaths(storeRoot).specChanges);
  if (contents === undefined) {
    return { specChanges: [], omitted: 0 };
  }

  const { blocks, omitted } = parseOwnedBlocks(contents, "SPEC");
  const specChanges: StoredSpecChange[] = [];
  let extraOmitted = 0;

  for (const block of blocks) {
    const operationMatch = block.body.match(/^Operation:\s*(add|revise)\s*$/im);
    const evidence = parseOwnedEvidence(block.metadata, block.quote);
    if (operationMatch?.[1] === undefined || evidence === undefined) {
      extraOmitted += 1;
      continue;
    }
    const content = block.body.replace(/^Operation:\s*(add|revise)\s*/i, "").trim();
    if (content.length === 0) {
      extraOmitted += 1;
      continue;
    }
    const createdAt = optionalString(block.metadata.createdAt);
    const updatedAt = optionalString(block.metadata.updatedAt);
    specChanges.push({
      id: block.id,
      section: block.title,
      operation: operationMatch[1] as "add" | "revise",
      content,
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      evidence,
    });
  }

  return { specChanges, omitted: omitted + extraOmitted };
}

async function readSources(storeRoot: string): Promise<StoredSourceMeta[]> {
  const paths = storePaths(storeRoot);
  let entries: string[];
  try {
    entries = await readdir(paths.sources);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const sources = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".md"))
      .sort()
      .map(async (entry) => {
        const { metadata } = splitFrontMatter(
          await readFile(join(paths.sources, entry), "utf8"),
        );
        const titleValue = metadata.title;
        return {
          id: stringValue(metadata.id, "source id"),
          title: typeof titleValue === "string" ? titleValue : null,
          metadataOnly: metadata.metadataOnly === true,
          importedAt: stringValue(metadata.importedAt, "importedAt"),
        };
      }),
  );

  return sources;
}

export async function readStore(storeRoot: string): Promise<StoreSnapshot> {
  const [decisions, taskResult, questionResult, glossaryResult, specResult, sources] =
    await Promise.all([
      readDecisions(storeRoot),
      readTasks(storeRoot),
      readQuestions(storeRoot),
      readGlossary(storeRoot),
      readSpecChanges(storeRoot),
      readSources(storeRoot),
    ]);

  return {
    decisions,
    tasks: taskResult.tasks,
    questions: questionResult.questions,
    glossary: glossaryResult.glossary,
    specChanges: specResult.specChanges,
    sources,
    omittedRecordCount:
      taskResult.omitted +
      questionResult.omitted +
      glossaryResult.omitted +
      specResult.omitted,
  };
}

export function toStoreDigest(snapshot: StoreSnapshot): StoreDigest {
  return StoreDigestSchema.parse({
    activeDecisions: snapshot.decisions
      .filter((decision) => decision.status === "active")
      .map(({ id, title, decision, tags }) => ({ id, title, decision, tags })),
    openTasks: snapshot.tasks
      .filter((task) => task.status === "open")
      .map(({ id, title }) => ({ id, title })),
    openQuestions: snapshot.questions
      .filter((question) => question.status === "open")
      .map(({ id, question }) => ({ id, question })),
    omittedRecordCount: snapshot.omittedRecordCount,
  });
}
