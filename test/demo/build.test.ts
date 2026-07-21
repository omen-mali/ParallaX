import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEMO_GENERATED_AT,
  DEMO_IMPORT_TIMESTAMPS,
  buildDemoArtifacts,
  buildTrackedDemo,
  checkTrackedDemo,
  compareArtifactTrees,
  readBuiltDemoSnapshot,
  trackedDemoPaths,
} from "../../src/demo/build.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "parallax-demo-test-"));
}

function expectVerifiedEvidence(evidence: {
  quote: string;
  sourceId?: string;
  turnIndex?: number;
  role?: string;
  startChar?: number;
  endChar?: number;
}): void {
  expect(evidence.quote.length).toBeGreaterThan(0);
  expect(evidence.sourceId).toMatch(/^src_[a-f0-9]{64}$/);
  expect(evidence.turnIndex).toBe(0);
  expect(evidence.role).toBe("user");
  expect(typeof evidence.startChar).toBe("number");
  expect(typeof evidence.endChar).toBe("number");
  expect(evidence.endChar!).toBeGreaterThan(evidence.startChar!);
}

describe("deterministic demo builder", () => {
  it("builds every record type with fixed lifecycle state and provenance", async () => {
    const outputRoot = await tempRoot();
    await buildDemoArtifacts(outputRoot);

    const snapshot = await readBuiltDemoSnapshot(outputRoot);
    expect(snapshot.sources).toHaveLength(3);
    expect(snapshot.sources.filter((source) => source.metadataOnly)).toHaveLength(1);
    expect(snapshot.sources.map((source) => source.importedAt).sort()).toEqual(
      [
        DEMO_IMPORT_TIMESTAMPS.historical,
        DEMO_IMPORT_TIMESTAMPS.current,
        DEMO_IMPORT_TIMESTAMPS.metadataOnly,
      ].sort(),
    );

    const historicalDecision = snapshot.decisions.find(
      (decision) => decision.title === "Keep project notes in one Markdown file",
    );
    const currentDecision = snapshot.decisions.find(
      (decision) =>
        decision.title === "Keep the approved project brain in versioned plain files",
    );
    const metadataOnlyDecision = snapshot.decisions.find(
      (decision) => decision.title === "Keep sensitive imports metadata-only",
    );
    expect(historicalDecision).toMatchObject({
      status: "superseded",
      updatedAt: DEMO_IMPORT_TIMESTAMPS.current,
    });
    expect(currentDecision).toMatchObject({
      status: "active",
      supersedes: historicalDecision?.id,
      createdAt: DEMO_IMPORT_TIMESTAMPS.current,
    });
    expect(metadataOnlyDecision?.evidence.sourceId).toBe(
      snapshot.sources.find((source) => source.metadataOnly)?.id,
    );

    expect(snapshot.decisions).toHaveLength(3);
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Migrate the original notes",
          status: "done",
        }),
        expect.objectContaining({
          title: "Publish the generated explorer",
          status: "open",
        }),
      ]),
    );
    expect(snapshot.tasks).toHaveLength(3);
    expect(snapshot.questions).toHaveLength(4);
    expect(snapshot.glossary).toHaveLength(4);
    expect(snapshot.specChanges).toHaveLength(4);

    for (const record of [
      ...snapshot.decisions,
      ...snapshot.tasks,
      ...snapshot.questions,
      ...snapshot.glossary,
      ...snapshot.specChanges,
    ]) {
      expectVerifiedEvidence(record.evidence);
    }

    const metadataOnlySource = snapshot.sources.find((source) => source.metadataOnly);
    expect(metadataOnlySource).toBeDefined();
    for (const records of [
      snapshot.decisions,
      snapshot.tasks,
      snapshot.questions,
      snapshot.glossary,
      snapshot.specChanges,
    ]) {
      expect(
        records.some((record) => record.evidence.sourceId === metadataOnlySource?.id),
      ).toBe(true);
    }

    const page = await readFile(join(outputRoot, "index.html"), "utf8");
    expect(page).toContain(DEMO_GENERATED_AT);
    expect(page).toContain("Keep project notes in one Markdown file");
    expect(page).toContain("Keep sensitive imports metadata-only");
    expect(page).toContain("Which release branch should publish the static explorer?");
    expect(page).toContain("managed region");
    expect(page).toContain("Retention boundary");
    expect(page).toContain("Transcript retention was disabled.");
  });

  it("produces byte-identical artifacts from the same fixtures", async () => {
    const firstOutput = await tempRoot();
    const secondOutput = await tempRoot();
    const first = await buildDemoArtifacts(firstOutput);
    const second = await buildDemoArtifacts(secondOutput);

    await expect(
      compareArtifactTrees(first.storeRoot, second.storeRoot, "demo/store"),
    ).resolves.toEqual([]);
    await expect(readFile(first.pagePath)).resolves.toEqual(
      await readFile(second.pagePath),
    );
  });

  it("checks tracked output for changed, missing, and extra generated files", async () => {
    const projectRoot = await tempRoot();
    const paths = trackedDemoPaths(projectRoot);
    await mkdir(join(projectRoot, "docs"), { recursive: true });
    await writeFile(join(projectRoot, "docs", "unrelated.txt"), "keep this file\n");

    await buildTrackedDemo(projectRoot);
    await expect(checkTrackedDemo(projectRoot)).resolves.toBeUndefined();
    await expect(
      readFile(join(projectRoot, "docs", "unrelated.txt"), "utf8"),
    ).resolves.toBe("keep this file\n");

    await writeFile(paths.pagePath, "changed\n");
    await expect(checkTrackedDemo(projectRoot)).rejects.toThrow(
      "changed docs/index.html",
    );

    await buildTrackedDemo(projectRoot);
    await rm(join(paths.storeRoot, "manifest.yaml"));
    await expect(checkTrackedDemo(projectRoot)).rejects.toThrow(
      "missing demo/store/manifest.yaml",
    );

    await buildTrackedDemo(projectRoot);
    await writeFile(join(paths.storeRoot, "unexpected.md"), "extra\n");
    await expect(checkTrackedDemo(projectRoot)).rejects.toThrow(
      "extra demo/store/unexpected.md",
    );
  });
});
