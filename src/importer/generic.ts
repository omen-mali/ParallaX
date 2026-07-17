import { createHash } from "node:crypto";
import { basename } from "node:path";

import {
  type ChatRole,
  type NormalizedChat,
  NormalizedChatSchema,
} from "../contract/types.js";

export function canonicalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseRole(heading: string): ChatRole | undefined {
  const match = heading.match(
    /^#{1,6}\s+(?:\*\*)?(system|user|assistant|tool)(?:\*\*)?\s*:?\s*$/i,
  );

  return match?.[1]?.toLowerCase() as ChatRole | undefined;
}

export interface ParsedChatExport {
  chat: NormalizedChat;
  rawHash: string;
}

/**
 * Parses Markdown with `## User` / `## Assistant` style headings. Text without
 * role headings is retained as one unknown turn instead of being discarded.
 */
export function parseGenericMarkdown(
  rawContents: string,
  fileName = "chat.md",
): ParsedChatExport {
  const contents = canonicalizeLineEndings(rawContents);
  const lines = contents.split("\n");
  const turnDrafts: Array<{ role: ChatRole; lines: string[] }> = [];
  let active: { role: ChatRole; lines: string[] } | undefined;
  let title: string | null = null;

  for (const line of lines) {
    const role = parseRole(line);
    if (role !== undefined) {
      active = { role, lines: [] };
      turnDrafts.push(active);
      continue;
    }

    if (title === null) {
      const titleMatch = line.match(/^#\s+(.+?)\s*$/);
      if (titleMatch?.[1] !== undefined) {
        title = titleMatch[1];
        continue;
      }
    }

    if (active !== undefined) {
      active.lines.push(line);
    }
  }

  const turns = turnDrafts
    .map(({ role, lines }, index) => ({
      index,
      role,
      text: lines.join("\n").trim(),
    }))
    .filter((turn) => turn.text.length > 0);

  if (turns.length === 0 && contents.trim().length > 0) {
    turns.push({ index: 0, role: "unknown", text: contents.trim() });
  }

  if (turns.length === 0) {
    throw new Error(`Chat export ${fileName} contains no text.`);
  }

  const reindexedTurns = turns.map((turn, index) => ({ ...turn, index }));
  const canonicalTranscript = JSON.stringify({
    source: "generic",
    title,
    turns: reindexedTurns,
  });
  const canonicalHash = sha256(canonicalTranscript);

  return {
    rawHash: sha256(rawContents),
    chat: NormalizedChatSchema.parse({
      schemaVersion: 1,
      id: `src_${canonicalHash}`,
      source: "generic",
      title: title ?? basename(fileName),
      turns: reindexedTurns,
    }),
  };
}
