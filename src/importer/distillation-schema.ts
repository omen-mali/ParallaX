import { z } from "zod";

import { ImportDeltaSchema } from "../contract/types.js";

export type JsonSchema = Record<string, unknown>;

/** Annotations that are not useful for provider-facing schema transmission. */
const NON_PORTABLE_ANNOTATIONS = new Set([
  "$schema",
  "default",
  "deprecated",
  "examples",
  "title",
]);

/**
 * Keywords rejected by Gemini's documented structured-output JSON Schema subset.
 * Keep these constraints in ImportDeltaSchema for local validation only.
 * @see https://ai.google.dev/gemini-api/docs/structured-output
 */
export const GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS = new Set(["minLength", "pattern"]);

const STRIPPED_KEYWORDS = new Set([
  ...NON_PORTABLE_ANNOTATIONS,
  ...GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS,
]);

export function stripUnsupportedSchemaKeywords(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUnsupportedSchemaKeywords);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !STRIPPED_KEYWORDS.has(key))
      .map(([key, child]) => [key, stripUnsupportedSchemaKeywords(child)]),
  );
}

/**
 * A lowest-common-denominator JSON Schema for model-side constrained output.
 * ImportDeltaSchema remains the authoritative local validator.
 */
export const IMPORT_DELTA_JSON_SCHEMA = stripUnsupportedSchemaKeywords(
  z.toJSONSchema(ImportDeltaSchema, { target: "draft-7" }),
) as JsonSchema;
