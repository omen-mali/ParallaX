import Anthropic from "@anthropic-ai/sdk";

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

export interface ClaudeMessagesRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user"; content: string }>;
  output_config: {
    format: {
      type: "json_schema";
      schema: JsonSchema;
    };
  };
}

export interface ClaudeMessagesClient {
  create(request: ClaudeMessagesRequest): Promise<{
    content: Array<{ type: string; text?: string }>;
  }>;
}

export type ClaudeClientFactory = (apiKey: string) => ClaudeMessagesClient;

const defaultClientFactory: ClaudeClientFactory = (apiKey) => {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return {
    create: async (request) => {
      const response = await client.messages.create({
        ...request,
        stream: false,
      });
      return {
        content: response.content as Array<{ type: string; text?: string }>,
      };
    },
  };
};

function extractText(
  content: Array<{ type: string; text?: string }>,
): string | undefined {
  const parts = content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("");
}

export class AnthropicDistiller implements Distiller {
  readonly provider = "claude" as const;

  constructor(
    private readonly createClient: ClaudeClientFactory = defaultClientFactory,
  ) {}

  async distill(
    chat: NormalizedChat,
    digest: StoreDigest,
    options: DistillOptions,
  ): Promise<ImportDelta> {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error("ANTHROPIC_API_KEY is required for the claude provider.");
    }

    const request = createDistillationRequest(chat, digest, options.model);
    let text: string | undefined;
    try {
      const response = await this.createClient(apiKey).create({
        model: request.model,
        max_tokens: 8192,
        system: request.instructions,
        messages: [{ role: "user", content: request.input }],
        output_config: {
          format: {
            type: "json_schema",
            schema: request.schema,
          },
        },
      });
      text = extractText(response.content);
    } catch (error: unknown) {
      throw mapProviderDistillationError("claude", error);
    }

    if (text === undefined || text.trim().length === 0) {
      throw new ProviderRefusalError("claude");
    }

    return parseProviderOutput("claude", text);
  }
}
