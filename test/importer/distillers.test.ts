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

describe("createDistiller lazy loading", () => {
  it("loads only the mock module when mock is selected", async () => {
    const loadOpenAI = vi.fn(async () => {
      throw new Error("OpenAI loader must not run for mock.");
    });
    const loadGemini = vi.fn(async () => {
      throw new Error("Gemini loader must not run for mock.");
    });
    const loadMock = vi.fn(async () => ({ MockDistiller: FakeMockDistiller }));

    const distiller = await createDistiller("mock", {
      loadMock,
      loadOpenAI,
      loadGemini,
    });

    expect(distiller.provider).toBe("mock");
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(loadOpenAI).not.toHaveBeenCalled();
    expect(loadGemini).not.toHaveBeenCalled();
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

    const loadMock = vi.fn(async () => ({ MockDistiller: FakeMockDistiller }));
    const loadOpenAI = vi.fn(async () => {
      throw new Error("OpenAI loader must not run for gemini.");
    });
    const loadGemini = vi.fn(async () => ({ GeminiDistiller: FakeGemini }));

    const distiller = await createDistiller("gemini", {
      loadMock,
      loadOpenAI,
      loadGemini,
    });

    expect(distiller.provider).toBe("gemini");
    expect(loadGemini).toHaveBeenCalledTimes(1);
    expect(loadMock).not.toHaveBeenCalled();
    expect(loadOpenAI).not.toHaveBeenCalled();
  });
});
