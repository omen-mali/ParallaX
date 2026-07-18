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
    loadClaude: vi.fn(async () => {
      throw new Error("Claude loader must not run.");
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
    expect(live.loadClaude).not.toHaveBeenCalled();
  });

  it("loads only the selected live provider module", async () => {
    class FakeClaude implements Distiller {
      readonly provider = "claude" as const;
      async distill() {
        return {
          summary: "claude",
          decisions: [],
          tasks: [],
          questions: [],
          glossary: [],
          specChanges: [],
        };
      }
    }

    const loadClaude = vi.fn(async () => ({ AnthropicDistiller: FakeClaude }));
    const distiller = await createDistiller("claude", {
      loadMock: vi.fn(async () => ({ MockDistiller: FakeMockDistiller })),
      loadOpenAI: vi.fn(async () => {
        throw new Error("OpenAI loader must not run for claude.");
      }),
      loadGemini: vi.fn(async () => {
        throw new Error("Gemini loader must not run for claude.");
      }),
      loadOpenAICompatible: vi.fn(async () => {
        throw new Error("Compatible loader must not run for claude.");
      }),
      loadClaude,
    });

    expect(distiller.provider).toBe("claude");
    expect(loadClaude).toHaveBeenCalledTimes(1);
  });
});
