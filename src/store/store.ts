import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { stringify } from "yaml";

import { STORE_SCHEMA_VERSION, type NormalizedChat } from "../contract/types.js";
import type { VerifiedImportDelta } from "../importer/verify.js";

const STORE_DIRECTORY = ".parallax";
const ISO_NOW = () => new Date().toISOString();

export interface StorePaths {
  root: string;
  sources: string;
  decisions: string;
  tasks: string;
  questions: string;
  glossary: string;
  specChanges: string;
  manifest: string;
}

export function storePaths(projectRoot: string): StorePaths {
  const root = join(projectRoot, STORE_DIRECTORY);
  return {
    root,
    sources: join(root, "sources"),
    decisions: join(root, "decisions"),
    tasks: join(root, "tasks.md"),
    questions: join(root, "questions.md"),
    glossary: join(root, "glossary.md"),
    specChanges: join(root, "spec-changes.md"),
    manifest: join(root, "manifest.yaml"),
  };
}

export async function initializeStore(projectRoot: string): Promise<StorePaths> {
  const paths = storePaths(projectRoot);
  await mkdir(paths.sources, { recursive: true });
  await mkdir(paths.decisions, { recursive: true });

  const initialFiles: Array<[string, string]> = [
    [
      paths.manifest,
      stringify({
        schemaVersion: STORE_SCHEMA_VERSION,
        kind: "manifest",
        createdAt: ISO_NOW(),
      }),
    ],
    [paths.tasks, "# ParallaX Tasks\n"],
    [paths.questions, "# ParallaX Questions\n"],
    [paths.glossary, "# ParallaX Glossary\n"],
    [paths.specChanges, "# ParallaX Spec Changes\n"],
  ];

  for (const [path, contents] of initialFiles) {
    try {
      await readFile(path, "utf8");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await writeFile(path, contents, "utf8");
    }
  }

  return paths;
}

export async function sourceAlreadyImported(
  projectRoot: string,
  sourceId: string,
): Promise<boolean> {
  try {
    await readFile(join(storePaths(projectRoot).sources, `${sourceId}.md`), "utf8");
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function frontMatter(data: Record<string, unknown>): string {
  return `---\n${stringify(data)}---\n`;
}

function recordId(prefix: string, seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function sourceMarkdown(
  chat: NormalizedChat,
  rawHash: string,
  metadataOnly: boolean,
): string {
  const now = ISO_NOW();
  const metadata = frontMatter({
    schemaVersion: STORE_SCHEMA_VERSION,
    kind: "source",
    id: chat.id,
    source: chat.source,
    title: chat.title,
    rawHash,
    canonicalHash: chat.id.slice("src_".length),
    importedAt: now,
    turnCount: chat.turns.length,
    metadataOnly,
  });

  if (metadataOnly) {
    return `${metadata}# ${chat.title ?? "Imported chat"}\n\nTranscript retention was disabled.\n`;
  }

  const turns = chat.turns
    .map((turn) => `## Turn ${turn.index} (${turn.role})\n\n${turn.text.trim()}\n`)
    .join("\n");
  return `${metadata}# ${chat.title ?? "Imported chat"}\n\n${turns}`;
}

function taskBlock(
  id: string,
  item: VerifiedImportDelta["tasks"][number],
  createdAt: string,
): string {
  const metadata = stringify({
    id,
    sourceId: item.evidence.sourceId,
    turnIndex: item.evidence.turnIndex,
    quoteHash: createHash("sha256").update(item.evidence.quote).digest("hex"),
    createdAt,
  }).trim();
  const detail = item.detail === null ? "" : `\n\n  ${item.detail}`;

  return `\n<!-- PARALLAX:TASK\n${metadata}\n-->\n- [ ] ${item.title}${detail}\n\n> ${item.evidence.quote}\n<!-- PARALLAX:TASK:END -->\n`;
}

function ownedBlock(
  kind: string,
  id: string,
  title: string,
  body: string,
  evidenceQuote: string,
): string {
  return `\n<!-- PARALLAX:${kind}\nid: ${id}\n-->\n## ${title}\n\n${body}\n\n> ${evidenceQuote}\n<!-- PARALLAX:${kind}:END -->\n`;
}

export interface ApplyImportOptions {
  projectRoot: string;
  chat: NormalizedChat;
  rawHash: string;
  delta: VerifiedImportDelta;
  metadataOnly: boolean;
}

export async function applyImport(options: ApplyImportOptions): Promise<void> {
  const paths = await initializeStore(options.projectRoot);
  const sourcePath = join(paths.sources, `${options.chat.id}.md`);
  if (await sourceAlreadyImported(options.projectRoot, options.chat.id)) {
    throw new Error(`Source ${options.chat.id} was already imported.`);
  }

  const now = ISO_NOW();
  await writeFile(
    sourcePath,
    sourceMarkdown(options.chat, options.rawHash, options.metadataOnly),
    "utf8",
  );

  for (const item of options.delta.decisions) {
    const id = recordId(
      "dec",
      `${options.chat.id}:${item.evidence.quote}:${item.title}`,
    );
    const decision = frontMatter({
      schemaVersion: STORE_SCHEMA_VERSION,
      kind: "decision",
      id,
      status: "active",
      createdAt: now,
      updatedAt: now,
      evidence: item.evidence,
      title: item.title,
      context: item.context,
      decision: item.decision,
      rationale: item.rationale,
      alternatives: item.alternatives,
      tags: item.tags,
      supersedes: item.supersedes ?? undefined,
    });
    const body = `# ${item.title}\n\n## Context\n\n${item.context}\n\n## Decision\n\n${item.decision}\n\n## Rationale\n\n${item.rationale}\n\n## Alternatives\n\n${item.alternatives.map((alternative) => `- ${alternative}`).join("\n") || "- None recorded"}\n`;
    await writeFile(join(paths.decisions, `${id}.md`), `${decision}${body}`, "utf8");
  }

  for (const item of options.delta.tasks) {
    const id = recordId(
      "task",
      `${options.chat.id}:${item.evidence.quote}:${item.title}`,
    );
    await appendFile(paths.tasks, taskBlock(id, item, now), "utf8");
  }

  for (const item of options.delta.questions) {
    const id = recordId("question", `${options.chat.id}:${item.evidence.quote}`);
    await appendFile(
      paths.questions,
      ownedBlock("QUESTION", id, item.question, "Status: open", item.evidence.quote),
      "utf8",
    );
  }

  for (const item of options.delta.glossary) {
    const id = recordId("term", `${options.chat.id}:${item.evidence.quote}`);
    await appendFile(
      paths.glossary,
      ownedBlock("TERM", id, item.term, item.definition, item.evidence.quote),
      "utf8",
    );
  }

  for (const item of options.delta.specChanges) {
    const id = recordId("spec", `${options.chat.id}:${item.evidence.quote}`);
    const body = `Operation: ${item.operation}\n\n${item.content}`;
    await appendFile(
      paths.specChanges,
      ownedBlock("SPEC", id, item.section, body, item.evidence.quote),
      "utf8",
    );
  }
}

export function formatProposal(
  chat: NormalizedChat,
  delta: VerifiedImportDelta,
): string {
  const lines = [
    `Proposal from ${basename(chat.title ?? chat.id)} (${chat.id})`,
    "",
    delta.summary,
  ];
  const sections: Array<
    [string, Array<{ evidence: { quote: string } } & Record<string, unknown>>]
  > = [
    ["Decisions", delta.decisions],
    ["Tasks", delta.tasks],
    ["Questions", delta.questions],
    ["Glossary", delta.glossary],
    ["Spec changes", delta.specChanges],
  ];

  for (const [name, items] of sections) {
    lines.push("", `${name}: ${items.length}`);
    for (const item of items) {
      const label =
        typeof item.title === "string"
          ? item.title
          : typeof item.question === "string"
            ? item.question
            : typeof item.term === "string"
              ? item.term
              : typeof item.section === "string"
                ? item.section
                : "Untitled";
      lines.push(`- ${label}`, `  Evidence: “${item.evidence.quote}”`);
    }
  }

  return `${lines.join("\n")}\n`;
}
