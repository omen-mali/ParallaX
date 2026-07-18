import { describe, expect, it, vi } from "vitest";

import { createDistiller } from "../../src/importer/distillers.js";
import type { Distiller } from "../../src/importer/distiller.js";

class FakeMockDistiller implements Distiller {
  readonly provider = "mock" as const;
  async distill() {
    return {
      summary: "mock",
      decisions: [],
      tasks: [],
      questions: [],
      glossary: [],
      specChanges: [],
    };
  }
}

function unusedLiveLoaders() {
  return {
    loadOpenAI: vi.fn(async () => {
      throw new Error("OpenAI loader must not run.");
    }),
    loadGemini: vi.fn(async () => {
      throw new Error("Gemini loader must not run.");
    }),
    loadOpenAICompatible: vi.fn(async () => {
      throw new Error("OpenAI-compatible loader must not run.");
    }),
  };
}

describe("createDistiller lazy loading", () => {
  it("loads only the mock module when mock is selected", async () => {
    const live = unusedLiveLoaders();
    const loadMock = vi.fn(async () => ({ MockDistiller: FakeMockDistiller }));

    const distiller = await createDistiller("mock", {
      loadMock,
      ...live,
    });

    expect(distiller.provider).toBe("mock");
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(live.loadOpenAI).not.toHaveBeenCalled();
    expect(live.loadGemini).not.toHaveBeenCalled();
    expect(live.loadOpenAICompatible).not.toHaveBeenCalled();
  });

  it("loads only the selected live provider module", async () => {
    class FakeGemini implements Distiller {
      readonly provider = "gemini" as const;
      async distill() {
        return {
          summary: "gemini",
          decisions: [],
          tasks: [],
          questions: [],
          glossary: [],
          specChanges: [],
        };
      }
    }

    class FakeCompatible implements Distiller {
      readonly provider = "openai-compatible" as const;
      async distill() {
        return {
          summary: "compatible",
          decisions: [],
          tasks: [],
          questions: [],
          glossary: [],
          specChanges: [],
        };
      }
    }

    const loadMock = vi.fn(async () => ({ MockDistiller: FakeMockDistiller }));
    const loadOpenAI = vi.fn(async () => {
      throw new Error("OpenAI loader must not run for gemini.");
    });
    const loadGemini = vi.fn(async () => ({ GeminiDistiller: FakeGemini }));
    const loadOpenAICompatible = vi.fn(async () => {
      throw new Error("Compatible loader must not run for gemini.");
    });

    const gemini = await createDistiller("gemini", {
      loadMock,
      loadOpenAI,
      loadGemini,
      loadOpenAICompatible,
    });
    expect(gemini.provider).toBe("gemini");
    expect(loadGemini).toHaveBeenCalledTimes(1);
    expect(loadMock).not.toHaveBeenCalled();
    expect(loadOpenAI).not.toHaveBeenCalled();
    expect(loadOpenAICompatible).not.toHaveBeenCalled();

    const compatible = await createDistiller("openai-compatible", {
      loadMock,
      loadOpenAI,
      loadGemini: vi.fn(async () => {
        throw new Error("Gemini loader must not run for compatible.");
      }),
      loadOpenAICompatible: vi.fn(async () => ({
        OpenAICompatibleDistiller: FakeCompatible,
      })),
    });
    expect(compatible.provider).toBe("openai-compatible");
  });

  it("does not load openai-compatible when openai is selected", async () => {
    class FakeOpenAI implements Distiller {
      readonly provider = "openai" as const;
      async distill() {
        return {
          summary: "openai",
          decisions: [],
          tasks: [],
          questions: [],
          glossary: [],
          specChanges: [],
        };
      }
    }

    const loadOpenAICompatible = vi.fn(async () => {
      throw new Error("Compatible loader must not run for openai.");
    });
    const distiller = await createDistiller("openai", {
      loadMock: vi.fn(async () => ({ MockDistiller: FakeMockDistiller })),
      loadOpenAI: vi.fn(async () => ({ OpenAIDistiller: FakeOpenAI })),
      loadGemini: vi.fn(async () => {
        throw new Error("Gemini loader must not run for openai.");
      }),
      loadOpenAICompatible,
    });

    expect(distiller.provider).toBe("openai");
    expect(loadOpenAICompatible).not.toHaveBeenCalled();
  });
});
