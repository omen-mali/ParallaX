import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createApplicationServices } from "../../src/application/services.js";
import type { NormalizedChat } from "../../src/contract/types.js";
import type { Distiller } from "../../src/importer/distiller.js";
import { distillWithMock } from "../../src/importer/mock-distiller.js";
import { startUiServer, type UiServerHandle } from "../../src/ui/server.js";

const token = "A".repeat(43);
const chat = `# Browser import

## User

Decision: Keep browser proposals ephemeral
Task: Apply only selected records
Question: Should the UI show evidence?
Term: session token - a per-launch local capability
Spec: revise | Local UI | Show a final confirmation before write.
`;

const handles: UiServerHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  vi.restoreAllMocks();
});

async function request(
  handle: UiServerHandle,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${handle.origin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: handle.origin,
      "X-Parallax-Session": token,
    },
    body: JSON.stringify(body),
  });
}

describe("local UI import flow", () => {
  it("distills once and persists only confirmed selected item types", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-ui-import-"));
    const distill = vi.fn(async (normalized: NormalizedChat) =>
      distillWithMock(normalized),
    );
    const distiller: Distiller = { provider: "mock", distill };
    const createDistiller = vi.fn(async () => distiller);
    const services = createApplicationServices({
      projectRoot: root,
      mock: true,
      createDistiller: createDistiller as never,
    });
    const openedUrls: string[] = [];
    const handle = await startUiServer({
      applicationServices: services,
      tokenGenerator: () => token,
      openBrowser: async (url) => {
        openedUrls.push(url);
      },
    });
    handles.push(handle);

    expect(openedUrls[0]).toBe(`${handle.origin}/#session=${token}`);

    const preview = await request(handle, "/api/imports/preview", {
      format: "generic",
      contents: chat,
      fileName: "browser.md",
      provider: "mock",
      model: "mock",
    });
    expect(preview.status).toBe(200);
    const previewPayload = (await preview.json()) as {
      proposal: { id: string; items: Array<{ key: string }> };
    };
    expect(previewPayload.proposal.items.map((item) => item.key)).toEqual([
      "d1",
      "t1",
      "q1",
      "g1",
      "s1",
    ]);
    expect(createDistiller).toHaveBeenCalledTimes(1);
    expect(distill).toHaveBeenCalledTimes(1);
    await expect(access(join(root, ".parallax"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const applied = await request(
      handle,
      `/api/proposals/${previewPayload.proposal.id}/apply`,
      {
        selectedKeys: ["d1", "t1", "q1", "g1", "s1"],
        metadataOnly: true,
        confirmed: true,
      },
    );
    expect(applied.status).toBe(200);
    const result = (await applied.json()) as {
      appliedCount: number;
      snapshot: {
        decisions: unknown[];
        tasks: unknown[];
        questions: unknown[];
        glossary: unknown[];
        specChanges: unknown[];
        sources: Array<{ metadataOnly: boolean }>;
      };
    };
    expect(result.appliedCount).toBe(5);
    expect(result.snapshot.decisions).toHaveLength(1);
    expect(result.snapshot.tasks).toHaveLength(1);
    expect(result.snapshot.questions).toHaveLength(1);
    expect(result.snapshot.glossary).toHaveLength(1);
    expect(result.snapshot.specChanges).toHaveLength(1);
    expect(result.snapshot.sources).toEqual([
      expect.objectContaining({ metadataOnly: true }),
    ]);

    const replay = await request(
      handle,
      `/api/proposals/${previewPayload.proposal.id}/apply`,
      {
        selectedKeys: ["d1"],
        metadataOnly: true,
        confirmed: true,
      },
    );
    expect(replay.status).toBe(409);
    expect(distill).toHaveBeenCalledTimes(1);
  });
});
