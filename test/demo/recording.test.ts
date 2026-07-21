import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createApplicationServices } from "../../src/application/services.js";

const recordingInputs = ["codex.md", "claude.md", "gemini.md"] as const;

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "parallax-recording-demo-"));
}

describe("three-tool recording scenario", () => {
  it("applies every sanitized input through the verified zero-network mock pipeline", async () => {
    const projectRoot = await tempProject();
    const services = createApplicationServices({ projectRoot, mock: true });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Recording fixtures must not use the network."));

    try {
      for (const fileName of recordingInputs) {
        const contents = await readFile(
          join(process.cwd(), "demo", "recording", fileName),
          "utf8",
        );
        const prepared = await services.prepareImport({
          contents,
          fileName,
          format: "generic",
          mock: true,
        });

        expect(prepared.provider).toEqual({ provider: "mock", model: "mock" });
        expect(prepared.items.length).toBeGreaterThan(0);
        await expect(
          services.applyPreparedImport(prepared, {
            metadataOnly: fileName === "claude.md",
          }),
        ).resolves.toEqual({ appliedCount: prepared.items.length });
      }

      const snapshot = await services.readSnapshot();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(snapshot.sources).toHaveLength(3);
      expect(snapshot.sources.filter((source) => source.metadataOnly)).toHaveLength(1);
      expect(snapshot.decisions.map((record) => record.title)).toEqual([
        "Keep approved project context in repo-local, versioned plain files",
        "Retain sensitive imports as metadata-only when source text should not be stored",
      ]);
      expect(snapshot.tasks.map((record) => record.title)).toEqual([
        "Add exact evidence verification before records can be applied",
      ]);
      expect(snapshot.questions.map((record) => record.question)).toEqual([
        "Which collaborators should have access to retained source transcripts?",
      ]);
      expect(snapshot.glossary).toEqual([
        expect.objectContaining({
          term: "provenance",
          definition: "Exact contiguous source evidence attached to an approved record",
        }),
      ]);
      expect(snapshot.specChanges).toEqual([
        expect.objectContaining({
          section: "Agent handoff",
          operation: "revise",
          content:
            "Compile approved project context into tool-specific instruction files.",
        }),
      ]);

      for (const record of [
        ...snapshot.decisions,
        ...snapshot.tasks,
        ...snapshot.questions,
        ...snapshot.glossary,
        ...snapshot.specChanges,
      ]) {
        expect(record.evidence).toMatchObject({
          sourceId: expect.stringMatching(/^src_[a-f0-9]{64}$/),
          turnIndex: 0,
          role: "user",
          startChar: expect.any(Number),
          endChar: expect.any(Number),
        });
        expect(record.evidence.quote.length).toBeGreaterThan(0);
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
