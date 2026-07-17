import OpenAI from "openai";

import {
  type ImportDelta,
  type NormalizedChat,
  type StoreDigest,
} from "../contract/types.js";
import {
  createDistillationRequest,
  parseProviderOutput,
  providerRequestError,
  type Distiller,
} from "./distiller.js";
import { DEFAULT_MODELS } from "./provider-config.js";

export const DEFAULT_MODEL = DEFAULT_MODELS.openai;

interface OpenAIResponse {
  output_text: string;
}

interface OpenAIClient {
  create(request: {
    model: string;
    instructions: string;
    input: string;
    store: false;
    text: {
      format: {
        type: "json_schema";
        name: string;
        schema: Record<string, unknown>;
        strict: true;
      };
    };
  }): Promise<OpenAIResponse>;
}

export type OpenAIClientFactory = (apiKey: string) => OpenAIClient;

const defaultClientFactory: OpenAIClientFactory = (apiKey) => {
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  return {
    create: async (request) => client.responses.create(request),
  };
};

export class OpenAIDistiller implements Distiller {
  readonly provider = "openai" as const;

  constructor(
    private readonly createClient: OpenAIClientFactory = defaultClientFactory,
  ) {}

  async distill(
    chat: NormalizedChat,
    digest: StoreDigest,
    options: { model: string; apiKey?: string },
  ): Promise<ImportDelta> {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error("OPENAI_API_KEY is required for the openai provider.");
    }

    const request = createDistillationRequest(chat, digest, options.model);
    let response: OpenAIResponse;
    try {
      response = await this.createClient(apiKey).create({
        model: request.model,
        instructions: request.instructions,
        input: request.input,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "parallax_import_delta",
            schema: request.schema,
            strict: true,
          },
        },
      });
    } catch {
      throw providerRequestError("openai");
    }

    return parseProviderOutput("openai", response.output_text);
  }
}

export interface OpenAIDistillerOptions {
  apiKey?: string;
  model?: string;
  createClient?: OpenAIClientFactory;
}

export async function distillWithOpenAI(
  chat: NormalizedChat,
  digest: StoreDigest,
  options: OpenAIDistillerOptions = {},
): Promise<ImportDelta> {
  return new OpenAIDistiller(options.createClient).distill(chat, digest, {
    model: options.model ?? process.env.PARALLAX_MODEL ?? DEFAULT_MODEL,
    apiKey: options.apiKey,
  });
}
