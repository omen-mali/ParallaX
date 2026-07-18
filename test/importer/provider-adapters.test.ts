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
import {
  OpenAICompatibleDistiller,
  type CompatibleChatCompletionRequest,
} from "../../src/importer/openai-compatible-distiller.js";
import {
  AnthropicDistiller,
  type ClaudeMessagesRequest,
} from "../../src/importer/claude-distiller.js";

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

describe("OpenAICompatibleDistiller", () => {
  it("submits chat-completions json_schema with portable schema", async () => {
    let captured: CompatibleChatCompletionRequest | undefined;
    let capturedBaseUrl: string | undefined;
    const distiller = new OpenAICompatibleDistiller(({ baseUrl }) => {
      capturedBaseUrl = baseUrl;
      return {
        create: async (request) => {
          captured = request;
          return { content: JSON.stringify(validDelta) };
        },
      };
    });

    await expect(
      distiller.distill(chat, digest, {
        model: "compat-model",
        apiKey: "test-key",
        baseUrl: "https://api.example.com/v1",
      }),
    ).resolves.toEqual(validDelta);

    expect(capturedBaseUrl).toBe("https://api.example.com/v1");
    expect(captured).toMatchObject({
      model: "compat-model",
      messages: [{ role: "system" }, { role: "user" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "parallax_import_delta",
          schema: IMPORT_DELTA_JSON_SCHEMA,
          strict: true,
        },
      },
    });
    expect(captured?.messages[0]?.content).toContain("untrusted data");
    expect(captured?.messages[1]?.content).toContain("[TURN 0 | ROLE user]");
  });

  it("requires baseUrl and sanitizes transport failures", async () => {
    const distiller = new OpenAICompatibleDistiller(() => ({
      create: async () => {
        throw new Error("secret-key Question: Which provider? raw-response");
      },
    }));

    await expect(
      distiller.distill(chat, digest, {
        model: "compat-model",
        apiKey: "secret-key",
      }),
    ).rejects.toThrow(/requires baseUrl/);

    await expect(
      distiller.distill(chat, digest, {
        model: "compat-model",
        apiKey: "secret-key",
        baseUrl: "https://api.example.com/v1",
      }),
    ).rejects.toThrow(
      "openai-compatible distillation failed. Check provider credentials, model access, and service availability.",
    );
  });

  it("treats empty content as a refusal and hides malformed bodies", async () => {
    await expect(
      new OpenAICompatibleDistiller(() => ({
        create: async () => ({ content: "  " }),
      })).distill(chat, digest, {
        model: "compat-model",
        apiKey: "test-key",
        baseUrl: "https://api.example.com/v1",
      }),
    ).rejects.toThrow("openai-compatible refused the request.");

    const raw = "raw-sensitive-response";
    try {
      await new OpenAICompatibleDistiller(() => ({
        create: async () => ({ content: raw }),
      })).distill(chat, digest, {
        model: "compat-model",
        apiKey: "test-key",
        baseUrl: "https://api.example.com/v1",
      });
      throw new Error("Expected malformed output to fail.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("openai-compatible returned an invalid import proposal.");
      expect(message).not.toContain(raw);
    }
  });
});

describe("AnthropicDistiller", () => {
  it("submits portable schema through output_config.format", async () => {
    let captured: ClaudeMessagesRequest | undefined;
    const distiller = new AnthropicDistiller(() => ({
      create: async (request) => {
        captured = request;
        return {
          content: [{ type: "text", text: JSON.stringify(validDelta) }],
        };
      },
    }));

    await expect(
      distiller.distill(chat, digest, {
        model: "claude-test",
        apiKey: "test-key",
      }),
    ).resolves.toEqual(validDelta);

    expect(captured).toMatchObject({
      model: "claude-test",
      max_tokens: 8192,
      output_config: {
        format: {
          type: "json_schema",
          schema: IMPORT_DELTA_JSON_SCHEMA,
        },
      },
    });
    expect(captured?.system).toContain("untrusted data");
    expect(captured?.messages[0]?.content).toContain("[TURN 0 | ROLE user]");
  });

  it("sanitizes transport failures and refuses non-text output", async () => {
    await expect(
      new AnthropicDistiller(() => ({
        create: async () => {
          throw new Error("secret-key Question: Which provider? raw-response");
        },
      })).distill(chat, digest, {
        model: "claude-test",
        apiKey: "secret-key",
      }),
    ).rejects.toThrow(
      "claude distillation failed. Check provider credentials, model access, and service availability.",
    );

    await expect(
      new AnthropicDistiller(() => ({
        create: async () => ({
          content: [{ type: "tool_use" }],
        }),
      })).distill(chat, digest, {
        model: "claude-test",
        apiKey: "test-key",
      }),
    ).rejects.toThrow("claude refused the request.");
  });

  it("hides malformed bodies", async () => {
    const raw = "raw-sensitive-response";
    try {
      await new AnthropicDistiller(() => ({
        create: async () => ({
          content: [{ type: "text", text: raw }],
        }),
      })).distill(chat, digest, {
        model: "claude-test",
        apiKey: "test-key",
      });
      throw new Error("Expected malformed output to fail.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("claude returned an invalid import proposal.");
      expect(message).not.toContain(raw);
    }
  });
});
