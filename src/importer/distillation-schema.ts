import { z } from "zod";

import { ImportDeltaSchema } from "../contract/types.js";

export type JsonSchema = Record<string, unknown>;

const NON_PORTABLE_ANNOTATIONS = new Set([
  "$schema",
  "default",
  "deprecated",
  "examples",
  "title",
]);

function portableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(portableValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !NON_PORTABLE_ANNOTATIONS.has(key))
      .map(([key, child]) => [key, portableValue(child)]),
  );
}

/**
 * A lowest-common-denominator JSON Schema for model-side constrained output.
 * ImportDeltaSchema remains the authoritative local validator.
 */
export const IMPORT_DELTA_JSON_SCHEMA = portableValue(
  z.toJSONSchema(ImportDeltaSchema, { target: "draft-7" }),
) as JsonSchema;
