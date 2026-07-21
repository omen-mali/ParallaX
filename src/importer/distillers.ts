import type { Distiller, ProviderId } from "./distiller.js";

export type DistillerModuleLoader = {
  loadMock: () => Promise<{ MockDistiller: new () => Distiller }>;
  loadOpenAI: () => Promise<{ OpenAIDistiller: new () => Distiller }>;
  loadGemini: () => Promise<{ GeminiDistiller: new () => Distiller }>;
  loadOpenAICompatible: () => Promise<{
    OpenAICompatibleDistiller: new () => Distiller;
  }>;
  loadClaude: () => Promise<{ AnthropicDistiller: new () => Distiller }>;
};

const defaultLoaders: DistillerModuleLoader = {
  loadMock: () => import("./mock-distiller.js"),
  loadOpenAI: () => import("./openai-distiller.js"),
  loadGemini: () => import("./gemini-distiller.js"),
  loadOpenAICompatible: () => import("./openai-compatible-distiller.js"),
  loadClaude: () => import("./claude-distiller.js"),
};

/**
 * Lazily load only the selected provider module so mock never imports
 * live SDK clients.
 */
export async function createDistiller(
  provider: ProviderId,
  loaders: DistillerModuleLoader = defaultLoaders,
): Promise<Distiller> {
  switch (provider) {
    case "mock": {
      const { MockDistiller } = await loaders.loadMock();
      return new MockDistiller();
    }
    case "openai": {
      const { OpenAIDistiller } = await loaders.loadOpenAI();
      return new OpenAIDistiller();
    }
    case "gemini": {
      const { GeminiDistiller } = await loaders.loadGemini();
      return new GeminiDistiller();
    }
    case "openai-compatible": {
      const { OpenAICompatibleDistiller } = await loaders.loadOpenAICompatible();
      return new OpenAICompatibleDistiller();
    }
    case "claude": {
      const { AnthropicDistiller } = await loaders.loadClaude();
      return new AnthropicDistiller();
    }
  }
}
