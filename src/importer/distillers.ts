import type { Distiller, ProviderId } from "./distiller.js";
import { GeminiDistiller } from "./gemini-distiller.js";
import { MockDistiller } from "./mock-distiller.js";
import { OpenAIDistiller } from "./openai-distiller.js";

export function createDistiller(provider: ProviderId): Distiller {
  switch (provider) {
    case "mock":
      return new MockDistiller();
    case "openai":
      return new OpenAIDistiller();
    case "gemini":
      return new GeminiDistiller();
  }
}
