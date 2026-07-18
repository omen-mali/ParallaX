import OpenAI from "openai";

import type { ImportDelta, NormalizedChat, StoreDigest } from "../contract/types.js";
import {
  createDistillationRequest,
  parseProviderOutput,
  type Distiller,
  type DistillOptions,
  type JsonSchema,
} from "./distiller.js";
import {
  mapProviderDistillationError,
  ProviderRefusalError,
} from "./provider-errors.js";

export interface CompatibleChatCompletionRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  response_format: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: true;
      schema: JsonSchema;
    };
  };
}

export interface CompatibleChatClient {
  create(
    request: CompatibleChatCompletionRequest,
  ): Promise<{ content?: string | null }>;
}

export type CompatibleClientFactory = (options: {
  apiKey: string;
  baseUrl: string;
}) => CompatibleChatClient;

const defaultClientFactory: CompatibleClientFactory = ({ apiKey, baseUrl }) => {
  const client = new OpenAI({ apiKey, baseURL: baseUrl, maxRetries: 0 });
  return {
    create: async (request) => {
      const response = await client.chat.completions.create(request);
      return { content: response.choices[0]?.message?.content };
    },
  };
};

export class OpenAICompatibleDistiller implements Distiller {
  readonly provider = "openai-compatible" as const;

  constructor(
    private readonly createClient: CompatibleClientFactory = defaultClientFactory,
  ) {}

  async distill(
    chat: NormalizedChat,
    digest: StoreDigest,
    options: DistillOptions,
  ): Promise<ImportDelta> {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error("OPENAI_API_KEY is required for the openai-compatible provider.");
    }
    if (options.baseUrl === undefined || options.baseUrl.length === 0) {
      throw new Error("openai-compatible requires baseUrl in .local/providers.yaml.");
    }

    const request = createDistillationRequest(chat, digest, options.model);
    let content: string | null | undefined;
    try {
      const response = await this.createClient({
        apiKey,
        baseUrl: options.baseUrl,
      }).create({
        model: request.model,
        messages: [
          { role: "system", content: request.instructions },
          { role: "user", content: request.input },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "parallax_import_delta",
            strict: true,
            schema: request.schema,
          },
        },
      });
      content = response.content;
    } catch (error: unknown) {
      throw mapProviderDistillationError("openai-compatible", error);
    }

    if (content === undefined || content === null || content.trim().length === 0) {
      throw new ProviderRefusalError("openai-compatible");
    }

    return parseProviderOutput("openai-compatible", content);
  }
}
