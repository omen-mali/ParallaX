import {
  ImportDeltaSchema,
  type ImportDelta,
  type NormalizedChat,
  type StoreDigest,
} from "../contract/types.js";
import {
  buildDistillationInput,
  DISTILLATION_INSTRUCTIONS,
} from "./distillation-prompt.js";
import { IMPORT_DELTA_JSON_SCHEMA, type JsonSchema } from "./distillation-schema.js";
import { ProviderMalformedOutputError } from "./provider-errors.js";

export type { JsonSchema } from "./distillation-schema.js";

export type ProviderId = "mock" | "openai" | "gemini" | "openai-compatible" | "claude";
export type LiveProviderId = Exclude<ProviderId, "mock">;
export type ProvidersRequiringExplicitModel = "openai-compatible" | "claude";

export interface DistillationRequest {
  instructions: string;
  input: string;
  schema: JsonSchema;
  model: string;
}

export interface DistillOptions {
  model: string;
  apiKey?: string;
  /** Required for openai-compatible; supplied only from local preset baseUrl. */
  baseUrl?: string;
}

export interface Distiller {
  readonly provider: ProviderId;
  distill(
    chat: NormalizedChat,
    digest: StoreDigest,
    options: DistillOptions,
  ): Promise<ImportDelta>;
}

export function createDistillationRequest(
  chat: NormalizedChat,
  digest: StoreDigest,
  model: string,
): DistillationRequest {
  return {
    instructions: DISTILLATION_INSTRUCTIONS,
    input: buildDistillationInput(chat, digest),
    schema: IMPORT_DELTA_JSON_SCHEMA,
    model,
  };
}

export function parseProviderOutput(
  provider: LiveProviderId,
  output: unknown,
): ImportDelta {
  try {
    const candidate = typeof output === "string" ? JSON.parse(output) : output;
    return ImportDeltaSchema.parse(candidate);
  } catch {
    throw new ProviderMalformedOutputError(provider);
  }
}
