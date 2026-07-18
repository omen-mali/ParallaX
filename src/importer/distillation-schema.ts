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

/**
 * Strip unsupported schema keywords recursively.
 * Keys under a `properties` map are domain field names and must be preserved
 * even when they collide with annotation names such as `title`.
 */
export function stripUnsupportedSchemaKeywords(value: unknown): unknown {
  return stripSchemaNode(value, "schema");
}

function stripSchemaNode(value: unknown, context: "schema" | "propertiesMap"): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => stripSchemaNode(child, "schema"));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (context === "propertiesMap") {
    return Object.fromEntries(
      entries.map(([key, child]) => [key, stripSchemaNode(child, "schema")]),
    );
  }

  return Object.fromEntries(
    entries
      .filter(([key]) => !STRIPPED_KEYWORDS.has(key))
      .map(([key, child]) => [
        key,
        stripSchemaNode(child, key === "properties" ? "propertiesMap" : "schema"),
      ]),
  );
}

/**
 * A lowest-common-denominator JSON Schema for model-side constrained output.
 * ImportDeltaSchema remains the authoritative local validator.
 */
export const IMPORT_DELTA_JSON_SCHEMA = stripUnsupportedSchemaKeywords(
  z.toJSONSchema(ImportDeltaSchema, { target: "draft-7" }),
) as JsonSchema;
