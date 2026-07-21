import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createApplicationServices } from "../../src/application/services.js";
import type { NormalizedChat } from "../../src/contract/types.js";
import type { Distiller } from "../../src/importer/distiller.js";
import { distillWithMock } from "../../src/importer/mock-distiller.js";

const allItemTypesChat = `# Local UI import

## User

Decision: Keep local UI proposals in memory
Task: Test selected browser imports
Question: Should browser writes require confirmation?
Term: loopback - bound only to the local machine
Spec: add | Local UI | Apply only browser-selected verified items.
`;

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "parallax-application-"));
}

function mockDistillerFactory(): {
  createDistiller: ReturnType<typeof vi.fn>;
  distill: ReturnType<typeof vi.fn>;
} {
  const distill = vi.fn(async (chat: NormalizedChat) => distillWithMock(chat));
  const distiller: Distiller = { provider: "mock", distill };
  const createDistiller = vi.fn(async () => distiller);
  return { createDistiller, distill };
}

describe("application services", () => {
  it("prepares one verified proposal, applies only selected items, and keeps metadata-only retention", async () => {
    const projectRoot = await tempProject();
    const { createDistiller, distill } = mockDistillerFactory();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Mock mode must not use the network."));
    const services = createApplicationServices({
      projectRoot,
      mock: true,
      createDistiller: createDistiller as never,
    });

    const prepared = await services.prepareImport({
      contents: allItemTypesChat,
      fileName: "ui.md",
      format: "generic",
      mock: true,
    });

    expect(createDistiller).toHaveBeenCalledTimes(1);
    expect(distill).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prepared.items.map((item) => item.key)).toEqual([
      "d1",
      "t1",
      "q1",
      "g1",
      "s1",
    ]);

    await expect(
      services.applyPreparedImport(prepared, { selectedKeys: [] }),
    ).rejects.toThrow(/select at least one/i);
    await expect(access(join(projectRoot, ".parallax"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    await expect(
      services.applyPreparedImport(prepared, { selectedKeys: ["d1", "d1"] }),
    ).rejects.toThrow(/duplicate/i);

    await expect(
      services.applyPreparedImport(prepared, {
        selectedKeys: ["d1", "q1", "s1"],
        metadataOnly: true,
      }),
    ).resolves.toEqual({ appliedCount: 3 });

    const snapshot = await services.readSnapshot();
    expect(snapshot.decisions).toHaveLength(1);
    expect(snapshot.tasks).toHaveLength(0);
    expect(snapshot.questions).toHaveLength(1);
    expect(snapshot.glossary).toHaveLength(0);
    expect(snapshot.specChanges).toHaveLength(1);
    expect(snapshot.sources).toEqual([expect.objectContaining({ metadataOnly: true })]);
    await expect(
      readFile(
        join(projectRoot, ".parallax", "sources", `${prepared.chat.id}.md`),
        "utf8",
      ),
    ).resolves.not.toContain("Keep local UI proposals in memory");
  });

  it("rejects an already-imported source before creating another distiller and compiles selected targets through the same store", async () => {
    const projectRoot = await tempProject();
    const firstFactory = mockDistillerFactory();
    const first = createApplicationServices({
      projectRoot,
      mock: true,
      createDistiller: firstFactory.createDistiller as never,
    });
    const prepared = await first.prepareImport({
      contents: allItemTypesChat,
      fileName: "ui.md",
      format: "generic",
      mock: true,
    });
    await first.applyPreparedImport(prepared);

    const secondFactory = mockDistillerFactory();
    const second = createApplicationServices({
      projectRoot,
      mock: true,
      createDistiller: secondFactory.createDistiller as never,
    });
    await expect(
      second.prepareImport({
        contents: allItemTypesChat,
        fileName: "ui.md",
        format: "generic",
        mock: true,
      }),
    ).rejects.toThrow(/already imported/i);
    expect(secondFactory.createDistiller).not.toHaveBeenCalled();

    await expect(second.compile({ targets: ["agents"] })).resolves.toEqual([
      expect.objectContaining({ target: "agents" }),
    ]);
    await expect(readFile(join(projectRoot, "AGENTS.md"), "utf8")).resolves.toContain(
      "Keep local UI proposals in memory",
    );
  });

  it("inspects and prepares an explicitly selected ChatGPT conversation through the same mock pipeline", async () => {
    const projectRoot = await tempProject();
    const { createDistiller, distill } = mockDistillerFactory();
    const services = createApplicationServices({
      projectRoot,
      mock: true,
      createDistiller: createDistiller as never,
    });
    const contents = await readFile(
      join(process.cwd(), "test", "fixtures", "chatgpt-conversations.json"),
      "utf8",
    );

    await expect(
      services.inspectChatGpt({ contents, fileName: "conversations.json" }),
    ).resolves.toContainEqual(expect.objectContaining({ id: "conv_project_brain" }));
    const prepared = await services.prepareImport({
      contents,
      fileName: "conversations.json",
      format: "chatgpt",
      conversationId: "conv_project_brain",
      mock: true,
    });

    expect(prepared.chat.source).toBe("chatgpt");
    expect(prepared.chat.title).toBe("Project brain plan");
    expect(distill).toHaveBeenCalledTimes(1);
  });

  it("locks UI mock mode against browser provider overrides when PARALLAX_MOCK is set", async () => {
    const projectRoot = await tempProject();
    const { createDistiller, distill } = mockDistillerFactory();
    const services = createApplicationServices({
      projectRoot,
      environment: { PARALLAX_MOCK: "1" },
      respectMockEnvironment: true,
      createDistiller: createDistiller as never,
    });

    await expect(services.getUiConfig()).resolves.toMatchObject({
      provider: "mock",
      model: "mock",
      mockLocked: true,
    });
    await services.prepareImport({
      contents: allItemTypesChat,
      fileName: "ui.md",
      format: "generic",
      provider: "openai",
      model: "gpt-5.6",
    });

    expect(createDistiller).toHaveBeenCalledWith("mock");
    expect(distill).toHaveBeenCalledTimes(1);
  });

  it("preserves provider and mock conflict validation before opening a UI", async () => {
    const services = createApplicationServices({
      projectRoot: await tempProject(),
      provider: "openai",
      mock: true,
      respectMockEnvironment: true,
    });

    await expect(services.getUiConfig()).rejects.toThrow(
      "--mock conflicts with a live --provider.",
    );
  });

  it("exposes only browser-safe compatible-provider configuration and forwards its selected model server-side", async () => {
    const projectRoot = await tempProject();
    const storeRoot = join(projectRoot, ".parallax");
    await mkdir(join(storeRoot, ".local"), { recursive: true });
    await writeFile(
      join(storeRoot, ".local", "providers.yaml"),
      "provider: openai-compatible\nmodel: local-model\nbaseUrl: https://compatible.example.test/v1\napiKeyEnv: LOCAL_COMPAT_KEY\n",
      "utf8",
    );
    const { createDistiller, distill } = mockDistillerFactory();
    const services = createApplicationServices({
      projectRoot,
      environment: { LOCAL_COMPAT_KEY: "test-key" },
      createDistiller: createDistiller as never,
    });

    await expect(services.getUiConfig()).resolves.toEqual({
      providers: ["mock", "openai", "gemini", "openai-compatible", "claude"],
      provider: "openai-compatible",
      model: "local-model",
      mock: false,
      mockLocked: false,
    });

    await services.prepareImport({
      contents: "## User\n\nDecision: Use the configured compatible provider",
      format: "generic",
    });
    expect(createDistiller).toHaveBeenCalledWith("openai-compatible");
    expect(distill).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        model: "local-model",
        apiKey: "test-key",
        baseUrl: "https://compatible.example.test/v1",
      }),
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
