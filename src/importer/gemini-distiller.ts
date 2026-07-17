import { GoogleGenAI } from "@google/genai";

import type { ImportDelta, NormalizedChat, StoreDigest } from "../contract/types.js";
import {
  createDistillationRequest,
  parseProviderOutput,
  providerRequestError,
  type Distiller,
  type JsonSchema,
} from "./distiller.js";

export interface GeminiInteractionRequest {
  model: string;
  input: string;
  system_instruction: string;
  store: false;
  response_format: {
    type: "text";
    mime_type: "application/json";
    schema: JsonSchema;
  };
}

export interface GeminiInteractionClient {
  create(request: GeminiInteractionRequest): Promise<{ outputText?: string }>;
}

export type GeminiClientFactory = (apiKey: string) => GeminiInteractionClient;

const defaultClientFactory: GeminiClientFactory = (apiKey) => {
  const client = new GoogleGenAI({ apiKey, apiVersion: "v1" });
  return {
    create: async (request) => {
      const response = await client.interactions.create(request, { maxRetries: 0 });
      return { outputText: response.output_text };
    },
  };
};

export class GeminiDistiller implements Distiller {
  readonly provider = "gemini" as const;

  constructor(
    private readonly createClient: GeminiClientFactory = defaultClientFactory,
  ) {}

  async distill(
    chat: NormalizedChat,
    digest: StoreDigest,
    options: { model: string; apiKey?: string },
  ): Promise<ImportDelta> {
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error("GEMINI_API_KEY is required for the gemini provider.");
    }

    const request = createDistillationRequest(chat, digest, options.model);
    let outputText: string | undefined;
    try {
      const response = await this.createClient(apiKey).create({
        model: request.model,
        input: request.input,
        system_instruction: request.instructions,
        store: false,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: request.schema,
        },
      });
      outputText = response.outputText;
    } catch {
      throw providerRequestError("gemini");
    }

    return parseProviderOutput("gemini", outputText);
  }
}
