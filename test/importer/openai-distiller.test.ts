import { describe, expect, it } from "vitest";

import { NormalizedChatSchema, StoreDigestSchema } from "../../src/contract/types.js";
import {
  buildDistillationInput,
  MAX_DIGEST_CHARACTERS,
  MAX_TRANSCRIPT_CHARACTERS,
} from "../../src/importer/openai-distiller.js";

const digest = StoreDigestSchema.parse({
  activeDecisions: [],
  openTasks: [],
  openQuestions: [],
  omittedRecordCount: 0,
});

describe("buildDistillationInput", () => {
  it("labels untrusted turns and bounds its inputs", () => {
    const chat = NormalizedChatSchema.parse({
      schemaVersion: 1,
      id: `src_${"a".repeat(64)}`,
      source: "generic",
      title: "Test chat",
      turns: [{ index: 0, role: "user", text: "Decision: Preserve provenance" }],
    });

    expect(buildDistillationInput(chat, digest)).toContain("[TURN 0 | ROLE user]");
  });

  it("fails clearly rather than truncating input", () => {
    const tooLargeChat = NormalizedChatSchema.parse({
      schemaVersion: 1,
      id: `src_${"b".repeat(64)}`,
      source: "generic",
      title: "Large chat",
      turns: [
        { index: 0, role: "user", text: "x".repeat(MAX_TRANSCRIPT_CHARACTERS + 1) },
      ],
    });
    const tooLargeDigest = StoreDigestSchema.parse({
      activeDecisions: [
        {
          id: "dec_large",
          title: "Large",
          decision: "x".repeat(MAX_DIGEST_CHARACTERS + 1),
          tags: [],
        },
      ],
      openTasks: [],
      openQuestions: [],
      omittedRecordCount: 0,
    });

    expect(() => buildDistillationInput(tooLargeChat, digest)).toThrow("Transcript");
    expect(() =>
      buildDistillationInput(
        NormalizedChatSchema.parse({
          schemaVersion: 1,
          id: `src_${"c".repeat(64)}`,
          source: "generic",
          title: "Small chat",
          turns: [{ index: 0, role: "user", text: "small" }],
        }),
        tooLargeDigest,
      ),
    ).toThrow("Store digest");
  });
});
