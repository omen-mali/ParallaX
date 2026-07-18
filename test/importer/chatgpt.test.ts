import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  listChatGptConversations,
  parseChatGptConversations,
} from "../../src/importer/chatgpt.js";

const fixturePath = join(process.cwd(), "test/fixtures/chatgpt-conversations.json");

async function fixture(): Promise<string> {
  return readFile(fixturePath, "utf8");
}

describe("parseChatGptConversations", () => {
  it("requires an explicit selection for a multi-conversation export", async () => {
    const rawContents = await fixture();
    expect(() => parseChatGptConversations(rawContents)).toThrow(
      /Use --conversation <id>\. Available: conv_project_brain \(Project brain plan\), conv_other \(Other chat\)/,
    );
  });

  it("lists short stable conversation choices without exposing transcript text", async () => {
    expect(listChatGptConversations(await fixture())).toEqual([
      { id: "conv_project_brain", title: "Project brain plan" },
      { id: "conv_other", title: "Other chat" },
    ]);
  });

  it("follows only the selected final parent chain and keeps supported text roles", async () => {
    const parsed = parseChatGptConversations(
      await fixture(),
      "conversations.json",
      "conv_project_brain",
    );

    expect(parsed.chat.source).toBe("chatgpt");
    expect(parsed.chat.title).toBe("Project brain plan");
    expect(parsed.chat.turns).toEqual([
      { index: 0, role: "system", text: "Keep provenance exact." },
      { index: 1, role: "user", text: "Plan the project brain.\nUse plain files." },
      { index: 2, role: "assistant", text: "Use a reviewable proposal." },
      { index: 3, role: "tool", text: "Tool result: validated" },
      {
        index: 4,
        role: "assistant",
        text: "Decision: keep the store local.\nTask: ship the static explorer.",
      },
    ]);
    expect(parsed.chat.turns.map((turn) => turn.text).join("\n")).not.toContain(
      "Ignore this old branch.",
    );
  });

  it("fails safely when the selected conversation does not exist", async () => {
    const rawContents = await fixture();
    expect(() =>
      parseChatGptConversations(rawContents, "conversations.json", "missing"),
    ).toThrow(/ChatGPT conversation missing was not found/);
  });

  it("permits a single conversation without a selection when it has a final branch", () => {
    const singleConversation = JSON.stringify([
      {
        id: "only",
        title: "Only chat",
        current_node: "leaf",
        mapping: {
          leaf: {
            message: {
              author: { role: "user" },
              content: { parts: ["Single text turn"] },
            },
            parent: null,
            children: [],
          },
        },
      },
    ]);

    expect(parseChatGptConversations(singleConversation).chat.turns).toEqual([
      { index: 0, role: "user", text: "Single text turn" },
    ]);
  });

  it("rejects unsupported or empty final-chain content", () => {
    const noText = JSON.stringify([
      {
        id: "no_text",
        title: "No text",
        current_node: "leaf",
        mapping: {
          leaf: {
            message: {
              author: { role: "assistant" },
              content: { parts: [{ asset_pointer: "file-service://image" }] },
            },
            parent: null,
            children: [],
          },
        },
      },
    ]);

    expect(() => parseChatGptConversations(noText)).toThrow(
      "ChatGPT conversation no_text contains no supported text turns.",
    );
  });

  it("rejects a conversation without current_node instead of inferring a branch", () => {
    const noFinalBranch = JSON.stringify([
      {
        id: "no_final_branch",
        title: "No final branch",
        mapping: {},
      },
    ]);

    expect(() => parseChatGptConversations(noFinalBranch)).toThrow(
      "ChatGPT conversation no_final_branch has no current_node final-branch reference.",
    );
  });

  it("rejects malformed JSON and broken final-parent chains", () => {
    expect(() => parseChatGptConversations("not-json")).toThrow(
      "must be valid JSON from an extracted conversations.json file",
    );

    const missingParent = JSON.stringify([
      {
        id: "missing_parent",
        current_node: "leaf",
        mapping: {
          leaf: { parent: "absent", message: null },
        },
      },
    ]);
    expect(() => parseChatGptConversations(missingParent)).toThrow(
      "has a missing parent-chain node: absent.",
    );

    const cycle = JSON.stringify([
      {
        id: "cycle",
        current_node: "leaf",
        mapping: {
          leaf: { parent: "leaf", message: null },
        },
      },
    ]);
    expect(() => parseChatGptConversations(cycle)).toThrow(
      "has a cycle in its parent chain.",
    );
  });

  it("rejects duplicate conversation IDs", () => {
    const duplicateIds = JSON.stringify([
      { id: "duplicate", mapping: {} },
      { conversation_id: "duplicate", mapping: {} },
    ]);

    expect(() => parseChatGptConversations(duplicateIds)).toThrow(
      "contains duplicate conversation ID duplicate.",
    );
  });
});
