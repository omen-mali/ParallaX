import { describe, expect, it } from "vitest";

import {
  ImportDeltaSchema,
  NormalizedChatSchema,
  StoreDigestSchema,
} from "../../src/contract/types.js";
import {
  createDistillationRequest,
  parseProviderOutput,
} from "../../src/importer/distiller.js";
import { IMPORT_DELTA_JSON_SCHEMA } from "../../src/importer/distillation-schema.js";
import {
  GeminiDistiller,
  type GeminiInteractionRequest,
} from "../../src/importer/gemini-distiller.js";
import { OpenAIDistiller } from "../../src/importer/openai-distiller.js";

const chat = NormalizedChatSchema.parse({
  schemaVersion: 1,
  id: `src_${"a".repeat(64)}`,
  source: "generic",
  title: "Provider test",
  turns: [{ index: 0, role: "user", text: "Question: Which provider?" }],
});

const digest = StoreDigestSchema.parse({
  activeDecisions: [],
  openTasks: [],
  openQuestions: [],
  omittedRecordCount: 0,
});

const validDelta = ImportDeltaSchema.parse({
  summary: "A valid provider response.",
  decisions: [],
  tasks: [],
  questions: [
    {
      question: "Which provider?",
      evidence: { turnIndex: 0, quote: "Question: Which provider?" },
    },
  ],
  glossary: [],
  specChanges: [],
});

describe("portable distillation request", () => {
  it("contains provider-neutral prompt, model, and JSON schema", () => {
    const request = createDistillationRequest(chat, digest, "test-model");

    expect(request.model).toBe("test-model");
    expect(request.input).toContain("[TURN 0 | ROLE user]");
    expect(request.instructions).toContain("untrusted data");
    expect(request.schema).toBe(IMPORT_DELTA_JSON_SCHEMA);
    expect(request.schema).not.toHaveProperty("$schema");
    expect(request.schema.properties).toHaveProperty("summary");
  });

  it("uses local Zod validation for provider output", () => {
    expect(parseProviderOutput("gemini", JSON.stringify(validDelta))).toEqual(
      validDelta,
    );
    expect(() =>
      parseProviderOutput("gemini", JSON.stringify({ summary: "incomplete" })),
    ).toThrow("gemini returned an invalid import proposal.");
  });
});

describe("OpenAIDistiller", () => {
  it("submits the portable schema through an adapter-local client", async () => {
    let captured: unknown;
    const distiller = new OpenAIDistiller(() => ({
      create: async (request) => {
        captured = request;
        return { output_text: JSON.stringify(validDelta) };
      },
    }));

    await expect(
      distiller.distill(chat, digest, {
        model: "openai-test",
        apiKey: "test-key",
      }),
    ).resolves.toEqual(validDelta);

    expect(captured).toMatchObject({
      model: "openai-test",
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "parallax_import_delta",
          schema: IMPORT_DELTA_JSON_SCHEMA,
          strict: true,
        },
      },
    });
  });

  it("sanitizes transport failures", async () => {
    const distiller = new OpenAIDistiller(() => ({
      create: async () => {
        throw new Error("secret-key Question: Which provider? raw-response");
      },
    }));

    await expect(
      distiller.distill(chat, digest, {
        model: "openai-test",
        apiKey: "secret-key",
      }),
    ).rejects.toThrow(
      "openai distillation failed. Check provider credentials, model access, and service availability.",
    );
  });
});

describe("GeminiDistiller", () => {
  it("uses structured output and explicitly disables interaction storage", async () => {
    let captured: GeminiInteractionRequest | undefined;
    const distiller = new GeminiDistiller(() => ({
      create: async (request) => {
        captured = request;
        return { outputText: JSON.stringify(validDelta) };
      },
    }));

    await expect(
      distiller.distill(chat, digest, {
        model: "gemini-test",
        apiKey: "test-key",
      }),
    ).resolves.toEqual(validDelta);

    expect(captured).toMatchObject({
      model: "gemini-test",
      store: false,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: IMPORT_DELTA_JSON_SCHEMA,
      },
    });
  });

  it("rejects malformed output locally without exposing it", async () => {
    const raw = "raw-sensitive-response";
    const distiller = new GeminiDistiller(() => ({
      create: async () => ({ outputText: raw }),
    }));

    try {
      await distiller.distill(chat, digest, {
        model: "gemini-test",
        apiKey: "test-key",
      });
      throw new Error("Expected malformed output to fail.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("gemini returned an invalid import proposal.");
      expect(message).not.toContain(raw);
    }
  });

  it("maps transport failures to sanitized typed errors", async () => {
    const distiller = new GeminiDistiller(() => ({
      create: async () => {
        throw Object.assign(new Error("secret-key Question: Which provider?"), {
          status: 401,
        });
      },
    }));

    try {
      await distiller.distill(chat, digest, {
        model: "gemini-test",
        apiKey: "secret-key",
      });
      throw new Error("Expected auth failure.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Authentication failed for gemini.");
      expect(message).not.toContain("secret-key");
      expect(message).not.toContain("Question:");
    }
  });

  it("treats empty Gemini output as a refusal", async () => {
    const distiller = new GeminiDistiller(() => ({
      create: async () => ({ outputText: "   " }),
    }));

    await expect(
      distiller.distill(chat, digest, {
        model: "gemini-test",
        apiKey: "test-key",
      }),
    ).rejects.toThrow("gemini refused the request.");
  });
});
