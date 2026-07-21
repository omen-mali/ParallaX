import { createHash } from "node:crypto";
import { basename } from "node:path";

import {
  type ChatRole,
  type NormalizedChat,
  NormalizedChatSchema,
} from "../contract/types.js";
import { canonicalizeLineEndings, type ParsedChatExport } from "./generic.js";

type JsonObject = Record<string, unknown>;

interface ChatGptConversation {
  id: string;
  title: string;
  mapping: JsonObject;
  currentNode: string | undefined;
}

export interface ChatGptConversationSummary {
  id: string;
  title: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function objectValue(value: unknown): JsonObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseConversations(
  rawContents: string,
  fileName: string,
): ChatGptConversation[] {
  let document: unknown;
  try {
    document = JSON.parse(rawContents);
  } catch {
    throw new Error(
      `ChatGPT import ${displayText(fileName)} must be valid JSON from an extracted conversations.json file; ZIP archives are not supported.`,
    );
  }

  if (!Array.isArray(document)) {
    throw new Error(
      `ChatGPT import ${displayText(fileName)} must contain a JSON array of conversations.`,
    );
  }

  const conversations: ChatGptConversation[] = [];
  for (const value of document) {
    const conversation = objectValue(value);
    const primaryId =
      conversation === undefined ? undefined : nonEmptyString(conversation.id);
    const fallbackId =
      conversation === undefined
        ? undefined
        : nonEmptyString(conversation.conversation_id);
    const mapping =
      conversation === undefined ? undefined : objectValue(conversation.mapping);
    if (
      primaryId !== undefined &&
      fallbackId !== undefined &&
      primaryId !== fallbackId
    ) {
      throw new Error(
        `ChatGPT import ${displayText(fileName)} contains conflicting conversation IDs.`,
      );
    }
    const id = primaryId ?? fallbackId;
    if (conversation === undefined || id === undefined || mapping === undefined) {
      continue;
    }
    conversations.push({
      id,
      title: nonEmptyString(conversation.title) ?? "Untitled conversation",
      mapping,
      currentNode: nonEmptyString(conversation.current_node),
    });
  }

  if (conversations.length === 0) {
    throw new Error(
      `ChatGPT import ${displayText(fileName)} contains no usable conversations.`,
    );
  }
  const ids = new Set<string>();
  for (const conversation of conversations) {
    if (ids.has(conversation.id)) {
      throw new Error(
        `ChatGPT import ${displayText(fileName)} contains duplicate conversation ID ${displayText(conversation.id)}.`,
      );
    }
    ids.add(conversation.id);
  }
  return conversations;
}

function conversationList(conversations: ChatGptConversation[]): string {
  const limit = 8;
  const listed = conversations
    .slice(0, limit)
    .map(
      (conversation) =>
        `${displayText(conversation.id)} (${displayText(conversation.title)})`,
    )
    .join(", ");
  const remainder = conversations.length - limit;
  return remainder > 0 ? `${listed}, and ${remainder} more` : listed;
}

function displayText(value: string): string {
  const compact = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

export function listChatGptConversations(
  rawContents: string,
  fileName = "conversations.json",
): ChatGptConversationSummary[] {
  return parseConversations(rawContents, fileName).map(({ id, title }) => ({
    id,
    title,
  }));
}

function selectConversation(
  conversations: ChatGptConversation[],
  conversationId: string | undefined,
): ChatGptConversation {
  if (conversationId === undefined) {
    if (conversations.length === 1) {
      return conversations[0]!;
    }
    throw new Error(
      `ChatGPT export contains ${conversations.length} conversations. Use --conversation <id>. Available: ${conversationList(conversations)}`,
    );
  }

  const selected = conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  if (selected === undefined) {
    throw new Error(
      `ChatGPT conversation ${displayText(conversationId)} was not found. Available: ${conversationList(conversations)}`,
    );
  }
  return selected;
}

function finalNodeId(conversation: ChatGptConversation): string {
  if (conversation.currentNode === undefined) {
    throw new Error(
      `ChatGPT conversation ${displayText(conversation.id)} has no current_node final-branch reference.`,
    );
  }
  if (objectValue(conversation.mapping[conversation.currentNode]) === undefined) {
    throw new Error(
      `ChatGPT conversation ${displayText(conversation.id)} has an invalid current_node reference.`,
    );
  }
  return conversation.currentNode;
}

function parentNodeId(node: JsonObject, conversationId: string): string | undefined {
  if (node.parent === null || node.parent === undefined) {
    return undefined;
  }
  const parent = nonEmptyString(node.parent);
  if (parent === undefined) {
    throw new Error(
      `ChatGPT conversation ${displayText(conversationId)} has an invalid parent reference.`,
    );
  }
  return parent;
}

function finalParentChain(conversation: ChatGptConversation): JsonObject[] {
  const chain: JsonObject[] = [];
  const visited = new Set<string>();
  let nodeId: string | undefined = finalNodeId(conversation);

  while (nodeId !== undefined) {
    if (visited.has(nodeId)) {
      throw new Error(
        `ChatGPT conversation ${displayText(conversation.id)} has a cycle in its parent chain.`,
      );
    }
    visited.add(nodeId);

    const node = objectValue(conversation.mapping[nodeId]);
    if (node === undefined) {
      throw new Error(
        `ChatGPT conversation ${displayText(conversation.id)} has a missing parent-chain node: ${displayText(nodeId)}.`,
      );
    }
    chain.push(node);
    nodeId = parentNodeId(node, conversation.id);
  }

  return chain.reverse();
}

function chatRole(message: JsonObject): ChatRole {
  const author = objectValue(message.author);
  const role = author === undefined ? undefined : nonEmptyString(author.role);
  if (role === "system" || role === "user" || role === "assistant" || role === "tool") {
    return role;
  }
  return "unknown";
}

function textParts(message: JsonObject): string | undefined {
  const content = objectValue(message.content);
  if (content === undefined || !Array.isArray(content.parts)) {
    return undefined;
  }
  const text = content.parts
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .trim();
  return text.length > 0 ? canonicalizeLineEndings(text) : undefined;
}

/**
 * Parses an extracted ChatGPT `conversations.json` export. A multi-conversation
 * export requires a caller-selected conversation ID so no branch is inferred.
 */
export function parseChatGptConversations(
  rawContents: string,
  fileName = "conversations.json",
  conversationId?: string,
): ParsedChatExport {
  const conversations = parseConversations(rawContents, fileName);
  const conversation = selectConversation(conversations, conversationId);
  const turns = finalParentChain(conversation)
    .flatMap((node) => {
      const message = objectValue(node.message);
      if (message === undefined) {
        return [];
      }
      const text = textParts(message);
      if (text === undefined) {
        return [];
      }
      return [{ role: chatRole(message), text }];
    })
    .map((turn, index) => ({ ...turn, index }));

  if (turns.length === 0) {
    throw new Error(
      `ChatGPT conversation ${displayText(conversation.id)} contains no supported text turns.`,
    );
  }

  const title = conversation.title || basename(fileName);
  const canonicalTranscript = JSON.stringify({
    source: "chatgpt",
    conversationId: conversation.id,
    title,
    turns,
  });
  const canonicalHash = sha256(canonicalTranscript);

  return {
    rawHash: sha256(rawContents),
    chat: NormalizedChatSchema.parse({
      schemaVersion: 1,
      id: `src_${canonicalHash}`,
      source: "chatgpt",
      title,
      turns,
    }),
  };
}
