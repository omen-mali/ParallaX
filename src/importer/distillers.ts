import type { Distiller, ProviderId } from "./distiller.js";

export type DistillerModuleLoader = {
  loadMock: () => Promise<{ MockDistiller: new () => Distiller }>;
  loadOpenAI: () => Promise<{ OpenAIDistiller: new () => Distiller }>;
  loadGemini: () => Promise<{ GeminiDistiller: new () => Distiller }>;
};

const defaultLoaders: DistillerModuleLoader = {
  loadMock: () => import("./mock-distiller.js"),
  loadOpenAI: () => import("./openai-distiller.js"),
  loadGemini: () => import("./gemini-distiller.js"),
};

/**
 * Lazily load only the selected provider module so mock never imports
 * OpenAI or Gemini SDK clients.
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
  }
}
