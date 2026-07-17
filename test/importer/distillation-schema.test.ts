import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ImportDeltaSchema,
  NormalizedChatSchema,
  StoreDigestSchema,
} from "../../src/contract/types.js";
import {
  GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS,
  IMPORT_DELTA_JSON_SCHEMA,
  stripUnsupportedSchemaKeywords,
} from "../../src/importer/distillation-schema.js";
import { createDistillationRequest } from "../../src/importer/distiller.js";
import {
  GeminiDistiller,
  type GeminiInteractionRequest,
} from "../../src/importer/gemini-distiller.js";
import { OpenAIDistiller } from "../../src/importer/openai-distiller.js";

const chat = NormalizedChatSchema.parse({
  schemaVersion: 1,
  id: `src_${"d".repeat(64)}`,
  source: "generic",
  title: "Schema test",
  turns: [{ index: 0, role: "user", text: "Question: Schema ok?" }],
});

const digest = StoreDigestSchema.parse({
  activeDecisions: [],
  openTasks: [],
  openQuestions: [],
  omittedRecordCount: 0,
});

const ALLOWED_SCHEMA_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "additionalProperties",
  "anyOf",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "maxLength",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "format",
  "description",
  "$defs",
  "$ref",
  "const",
]);

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectKeys(child, keys);
    }
    return keys;
  }
  if (value === null || typeof value !== "object") {
    return keys;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

function assertSchemaKeywordsAllowed(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertSchemaKeywordsAllowed(child, `${path}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  const looksLikeSchemaObject =
    "type" in record ||
    "properties" in record ||
    "items" in record ||
    "anyOf" in record ||
    "enum" in record ||
    "$ref" in record;
  if (looksLikeSchemaObject) {
    for (const key of Object.keys(record)) {
      expect(
        ALLOWED_SCHEMA_KEYWORDS.has(key),
        `${path}.${key} is not an allowed schema keyword`,
      ).toBe(true);
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "properties") {
      // Property names are domain fields, not schema keywords.
      if (child !== null && typeof child === "object" && !Array.isArray(child)) {
        for (const [propName, propSchema] of Object.entries(
          child as Record<string, unknown>,
        )) {
          assertSchemaKeywordsAllowed(propSchema, `${path}.properties.${propName}`);
        }
      }
      continue;
    }
    assertSchemaKeywordsAllowed(child, `${path}.${key}`);
  }
}

function assertNoUnsupportedKeywords(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertNoUnsupportedKeywords(child, `${path}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    expect(
      GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS.has(key),
      `${path}.${key} must not appear in the portable schema`,
    ).toBe(false);
    assertNoUnsupportedKeywords(child, `${path}.${key}`);
  }
}

describe("portable distillation schema", () => {
  it("recursively strips Gemini-unsupported keywords", () => {
    const raw = z.toJSONSchema(ImportDeltaSchema, { target: "draft-7" });
    const rawKeys = collectKeys(raw);
    expect(rawKeys.has("minLength")).toBe(true);
    expect(rawKeys.has("pattern")).toBe(true);

    assertNoUnsupportedKeywords(IMPORT_DELTA_JSON_SCHEMA);
    expect(collectKeys(IMPORT_DELTA_JSON_SCHEMA).has("minLength")).toBe(false);
    expect(collectKeys(IMPORT_DELTA_JSON_SCHEMA).has("pattern")).toBe(false);
  });

  it("preserves supported structure for objects, arrays, enums, and unions", () => {
    const schema = IMPORT_DELTA_JSON_SCHEMA;
    expect(schema.type).toBe("object");
    expect(schema.properties).toMatchObject({
      summary: { type: "string" },
      decisions: { type: "array" },
    });
    expect(schema).toHaveProperty("required");
    expect(schema).toHaveProperty("additionalProperties");

    const decisionItems = (
      (schema.properties as Record<string, Record<string, unknown>>).decisions
        .items as Record<string, unknown>
    ).properties as Record<string, Record<string, unknown>>;
    expect(decisionItems.evidence.type).toBe("object");
    expect(decisionItems.tags.type).toBe("array");
    expect(decisionItems.supersedes.anyOf).toEqual(
      expect.arrayContaining([{ type: "string" }, { type: "null" }]),
    );

    const operation = (
      (
        (schema.properties as Record<string, Record<string, unknown>>).specChanges
          .items as Record<string, unknown>
      ).properties as Record<string, Record<string, unknown>>
    ).operation;
    expect(operation.enum).toEqual(["add", "revise"]);

    assertSchemaKeywordsAllowed(schema);
  });

  it("still enforces stripped constraints via local Zod validation", () => {
    expect(() =>
      ImportDeltaSchema.parse({
        summary: "",
        decisions: [],
        tasks: [],
        questions: [],
        glossary: [],
        specChanges: [],
      }),
    ).toThrow();

    expect(() =>
      ImportDeltaSchema.parse({
        summary: "ok",
        decisions: [
          {
            title: "T",
            context: "C",
            decision: "D",
            rationale: "R",
            alternatives: [],
            supersedes: "not-a-decision-id",
            tags: ["BAD_TAG"],
            evidence: { turnIndex: 0, quote: "q" },
          },
        ],
        tasks: [],
        questions: [],
        glossary: [],
        specChanges: [],
      }),
    ).toThrow();
  });

  it("gives OpenAI and Gemini adapters the same stripped schema", async () => {
    const portable = createDistillationRequest(chat, digest, "model").schema;
    expect(portable).toBe(IMPORT_DELTA_JSON_SCHEMA);

    let openaiSchema: unknown;
    let geminiSchema: unknown;
    const valid = ImportDeltaSchema.parse({
      summary: "ok",
      decisions: [],
      tasks: [],
      questions: [
        {
          question: "Schema ok?",
          evidence: { turnIndex: 0, quote: "Question: Schema ok?" },
        },
      ],
      glossary: [],
      specChanges: [],
    });

    await new OpenAIDistiller(() => ({
      create: async (request) => {
        openaiSchema = request.text.format.schema;
        return { output_text: JSON.stringify(valid) };
      },
    })).distill(chat, digest, { model: "openai", apiKey: "k" });

    await new GeminiDistiller(() => ({
      create: async (request: GeminiInteractionRequest) => {
        geminiSchema = request.response_format.schema;
        return { outputText: JSON.stringify(valid) };
      },
    })).distill(chat, digest, { model: "gemini", apiKey: "k" });

    expect(openaiSchema).toBe(IMPORT_DELTA_JSON_SCHEMA);
    expect(geminiSchema).toBe(IMPORT_DELTA_JSON_SCHEMA);
  });

  it("strips nested unsupported keywords from arbitrary objects", () => {
    expect(
      stripUnsupportedSchemaKeywords({
        type: "object",
        properties: {
          nested: {
            type: "string",
            minLength: 1,
            pattern: "^x$",
            title: "drop",
          },
        },
        anyOf: [{ type: "string", minLength: 2 }, { type: "null" }],
      }),
    ).toEqual({
      type: "object",
      properties: {
        nested: {
          type: "string",
        },
      },
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });
});
