import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

import { StoreDigestSchema, type ImportDelta } from "../contract/types.js";
import { parseGenericMarkdown, type ParsedChatExport } from "../importer/generic.js";
import { distillWithMock } from "../importer/mock-distiller.js";
import { verifyImportDelta } from "../importer/verify.js";
import { readStore, toStoreDigest, type StoreSnapshot } from "../store/read.js";
import { applyImport, storePaths } from "../store/store.js";
import { generateTimeline } from "../web/timeline.js";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const DEMO_GENERATED_AT = "2025-03-11T12:00:00.000Z";
export const DEMO_IMPORT_TIMESTAMPS = {
  historical: "2025-01-15T09:00:00.000Z",
  current: "2025-02-20T10:30:00.000Z",
  metadataOnly: "2025-03-10T14:45:00.000Z",
} as const;

export const DEMO_LIFECYCLE_UPDATED_AT = DEMO_IMPORT_TIMESTAMPS.current;

const EMPTY_DIGEST = StoreDigestSchema.parse({
  activeDecisions: [],
  openTasks: [],
  openQuestions: [],
  omittedRecordCount: 0,
});

interface DemoFixture {
  name: "historical.md" | "current.md" | "metadata-only.md";
  metadataOnly: boolean;
  appliedAt: string;
  expected: {
    decisions: number;
    tasks: number;
    questions: number;
    glossary: number;
    specChanges: number;
  };
}

const HISTORICAL_FIXTURE: DemoFixture = {
  name: "historical.md",
  metadataOnly: false,
  appliedAt: DEMO_IMPORT_TIMESTAMPS.historical,
  expected: {
    decisions: 1,
    tasks: 1,
    questions: 1,
    glossary: 1,
    specChanges: 1,
  },
};

const CURRENT_FIXTURE: DemoFixture = {
  name: "current.md",
  metadataOnly: false,
  appliedAt: DEMO_IMPORT_TIMESTAMPS.current,
  expected: {
    decisions: 1,
    tasks: 1,
    questions: 2,
    glossary: 2,
    specChanges: 2,
  },
};

const METADATA_ONLY_FIXTURE: DemoFixture = {
  name: "metadata-only.md",
  metadataOnly: true,
  appliedAt: DEMO_IMPORT_TIMESTAMPS.metadataOnly,
  expected: {
    decisions: 1,
    tasks: 1,
    questions: 1,
    glossary: 1,
    specChanges: 1,
  },
};

export interface DemoArtifactPaths {
  root: string;
  storeRoot: string;
  pagePath: string;
}

export interface DemoBuildOptions {
  fixtureRoot?: string;
}

export interface DemoTrackedPaths {
  storeRoot: string;
  pagePath: string;
}

export function demoArtifactPaths(outputRoot: string): DemoArtifactPaths {
  const root = resolve(outputRoot);
  return {
    root,
    storeRoot: join(root, "store"),
    pagePath: join(root, "index.html"),
  };
}

export function trackedDemoPaths(projectRoot: string): DemoTrackedPaths {
  const root = resolve(projectRoot);
  return {
    storeRoot: join(root, "demo", "store"),
    pagePath: join(root, "docs", "index.html"),
  };
}

function defaultFixtureRoot(): string {
  return join(SOURCE_ROOT, "demo", "fixtures");
}

function assertFixtureShape(candidate: ImportDelta, fixture: DemoFixture): void {
  const actual = {
    decisions: candidate.decisions.length,
    tasks: candidate.tasks.length,
    questions: candidate.questions.length,
    glossary: candidate.glossary.length,
    specChanges: candidate.specChanges.length,
  };

  for (const [kind, expected] of Object.entries(fixture.expected)) {
    if (actual[kind as keyof typeof actual] !== expected) {
      throw new Error(
        `Demo fixture ${fixture.name} must produce ${expected} ${kind}; received ${actual[kind as keyof typeof actual]}.`,
      );
    }
  }
}

async function parseFixture(
  fixtureRoot: string,
  fixture: DemoFixture,
): Promise<ParsedChatExport> {
  const rawContents = await readFile(join(fixtureRoot, fixture.name), "utf8");
  return parseGenericMarkdown(rawContents, fixture.name);
}

async function applyFixture(
  storeRoot: string,
  fixtureRoot: string,
  fixture: DemoFixture,
  digest = EMPTY_DIGEST,
  prepareProposal?: (candidate: ImportDelta) => ImportDelta,
): Promise<ParsedChatExport> {
  const parsed = await parseFixture(fixtureRoot, fixture);
  const initialProposal = distillWithMock(parsed.chat);
  assertFixtureShape(initialProposal, fixture);
  const proposal = prepareProposal?.(initialProposal) ?? initialProposal;
  const verified = verifyImportDelta(proposal, parsed.chat, digest);

  await applyImport({
    storeRoot,
    chat: parsed.chat,
    rawHash: parsed.rawHash,
    delta: verified,
    metadataOnly: fixture.metadataOnly,
    appliedAt: fixture.appliedAt,
  });

  return parsed;
}

function oneRecord<T>(
  records: T[],
  predicate: (record: T) => boolean,
  label: string,
): T {
  const matching = records.filter(predicate);
  if (matching.length !== 1 || matching[0] === undefined) {
    throw new Error(`Expected exactly one ${label}; found ${matching.length}.`);
  }
  return matching[0];
}

function yamlObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label} to contain YAML object metadata.`);
  }
  return value as Record<string, unknown>;
}

async function updateDecisionLifecycle(
  storeRoot: string,
  decisionId: string,
): Promise<void> {
  const paths = storePaths(storeRoot);
  const path = join(paths.decisions, `${decisionId}.md`);
  const contents = await readFile(path, "utf8");
  const match = contents.match(/^---\n([\s\S]*?)---\n([\s\S]*)$/);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Expected generated decision ${decisionId} to have front matter.`);
  }

  const metadata = yamlObject(parse(match[1]), `decision ${decisionId}`);
  if (metadata.id !== decisionId) {
    throw new Error(`Expected generated decision metadata to identify ${decisionId}.`);
  }

  const nextMetadata = {
    ...metadata,
    status: "superseded",
    updatedAt: DEMO_LIFECYCLE_UPDATED_AT,
  };
  await writeFile(path, `---\n${stringify(nextMetadata)}---\n${match[2]}`, "utf8");
}

const TASK_BLOCK_PATTERN =
  /<!-- PARALLAX:TASK\n([\s\S]*?)\n-->\n- \[([ x])\] (.+?)(?:\n|$)([\s\S]*?)<!-- PARALLAX:TASK:END -->/g;

async function updateTaskLifecycle(storeRoot: string, taskId: string): Promise<void> {
  const paths = storePaths(storeRoot);
  const contents = await readFile(paths.tasks, "utf8");
  let updated = false;

  const nextContents = contents.replace(
    TASK_BLOCK_PATTERN,
    (block: string, metadataRaw: string) => {
      const metadata = yamlObject(parse(metadataRaw), `task ${taskId}`);
      if (metadata.id !== taskId) {
        return block;
      }
      updated = true;
      const nextMetadata = {
        ...metadata,
        updatedAt: DEMO_LIFECYCLE_UPDATED_AT,
      };
      const nextMarker = `<!-- PARALLAX:TASK\n${stringify(nextMetadata).trim()}\n-->`;
      return block
        .replace(`<!-- PARALLAX:TASK\n${metadataRaw}\n-->`, nextMarker)
        .replace(/(\n- \[)[ x](\] )/, "$1x$2");
    },
  );

  if (!updated) {
    throw new Error(`Expected generated task ${taskId} to have an owned task block.`);
  }

  await writeFile(paths.tasks, nextContents, "utf8");
}

function currentProposalSuperseding(
  historicalDecisionId: string,
): (candidate: ImportDelta) => ImportDelta {
  return (candidate) => {
    const [decision] = candidate.decisions;
    if (candidate.decisions.length !== 1 || decision === undefined) {
      throw new Error("The current demo fixture must contain exactly one decision.");
    }
    return {
      ...candidate,
      decisions: [{ ...decision, supersedes: historicalDecisionId }],
    };
  };
}

async function buildDemoStore(storeRoot: string, fixtureRoot: string): Promise<void> {
  const historical = await applyFixture(storeRoot, fixtureRoot, HISTORICAL_FIXTURE);
  const historicalSnapshot = await readStore(storeRoot);
  const historicalDecision = oneRecord(
    historicalSnapshot.decisions,
    (decision) => decision.evidence.sourceId === historical.chat.id,
    "historical decision",
  );
  const historicalTask = oneRecord(
    historicalSnapshot.tasks,
    (task) => task.evidence.sourceId === historical.chat.id,
    "historical task",
  );

  await applyFixture(
    storeRoot,
    fixtureRoot,
    CURRENT_FIXTURE,
    toStoreDigest(historicalSnapshot),
    currentProposalSuperseding(historicalDecision.id),
  );

  await updateDecisionLifecycle(storeRoot, historicalDecision.id);
  await updateTaskLifecycle(storeRoot, historicalTask.id);

  const currentSnapshot = await readStore(storeRoot);
  await applyFixture(
    storeRoot,
    fixtureRoot,
    METADATA_ONLY_FIXTURE,
    toStoreDigest(currentSnapshot),
  );
}

/**
 * Build the generated store and HTML into an isolated output directory. The
 * output directory is intended to be a temporary staging directory.
 */
export async function buildDemoArtifacts(
  outputRoot: string,
  options: DemoBuildOptions = {},
): Promise<DemoArtifactPaths> {
  const paths = demoArtifactPaths(outputRoot);
  const fixtureRoot = options.fixtureRoot ?? defaultFixtureRoot();

  await rm(paths.storeRoot, { recursive: true, force: true });
  await rm(paths.pagePath, { force: true });
  await buildDemoStore(paths.storeRoot, fixtureRoot);
  await generateTimeline(paths.storeRoot, paths.pagePath, {
    generatedAt: DEMO_GENERATED_AT,
  });

  return paths;
}

async function stageDemoArtifacts(
  options: DemoBuildOptions = {},
): Promise<DemoArtifactPaths> {
  const stagingRoot = await mkdtemp(join(tmpdir(), "parallax-demo-"));
  return buildDemoArtifacts(stagingRoot, options);
}

async function removeStaging(paths: DemoArtifactPaths): Promise<void> {
  await rm(paths.root, { recursive: true, force: true });
}

async function replaceDirectory(source: string, target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

/**
 * Rebuild the tracked outputs only after a complete temporary build succeeds.
 */
export async function buildTrackedDemo(
  projectRoot = process.cwd(),
  options: DemoBuildOptions = {},
): Promise<DemoTrackedPaths> {
  const targets = trackedDemoPaths(projectRoot);
  const staged = await stageDemoArtifacts(options);
  try {
    await replaceDirectory(staged.storeRoot, targets.storeRoot);
    await mkdir(dirname(targets.pagePath), { recursive: true });
    await copyFile(staged.pagePath, targets.pagePath);
  } finally {
    await removeStaging(staged);
  }
  return targets;
}

type TreeEntry = { kind: "directory" } | { kind: "file"; contents: Buffer };

async function treeEntries(root: string): Promise<Map<string, TreeEntry>> {
  const entries = new Map<string, TreeEntry>();

  async function collect(directory: string, prefix: string): Promise<void> {
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const child of children.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const relativePath = prefix.length === 0 ? child.name : `${prefix}/${child.name}`;
      const path = join(directory, child.name);
      if (child.isDirectory()) {
        entries.set(relativePath, { kind: "directory" });
        await collect(path, relativePath);
      } else if (child.isFile()) {
        entries.set(relativePath, { kind: "file", contents: await readFile(path) });
      } else {
        throw new Error(`Generated demo artifacts cannot contain ${relativePath}.`);
      }
    }
  }

  await collect(root, "");
  return entries;
}

/**
 * Compare a generated tree with its tracked counterpart. Returned messages are
 * stable and describe every changed, missing, or extra path.
 */
export async function compareArtifactTrees(
  expectedRoot: string,
  actualRoot: string,
  label: string,
): Promise<string[]> {
  const [expected, actual] = await Promise.all([
    treeEntries(expectedRoot),
    treeEntries(actualRoot),
  ]);
  const paths = new Set([...expected.keys(), ...actual.keys()]);
  const differences: string[] = [];

  for (const path of [...paths].sort()) {
    const expectedEntry = expected.get(path);
    const actualEntry = actual.get(path);
    if (expectedEntry === undefined) {
      differences.push(`extra ${label}/${path}`);
      continue;
    }
    if (actualEntry === undefined) {
      differences.push(`missing ${label}/${path}`);
      continue;
    }
    if (expectedEntry.kind !== actualEntry.kind) {
      differences.push(`changed ${label}/${path}`);
      continue;
    }
    if (
      expectedEntry.kind === "file" &&
      actualEntry.kind === "file" &&
      !expectedEntry.contents.equals(actualEntry.contents)
    ) {
      differences.push(`changed ${label}/${path}`);
    }
  }

  return differences;
}

async function compareArtifactFile(
  expectedPath: string,
  actualPath: string,
  label: string,
): Promise<string[]> {
  let actual: Buffer;
  try {
    actual = await readFile(actualPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [`missing ${label}`];
    }
    throw error;
  }
  const expected = await readFile(expectedPath);
  return expected.equals(actual) ? [] : [`changed ${label}`];
}

/**
 * Verify that the committed demo store and HTML exactly match a fresh
 * temporary build. This never writes to the tracked project paths.
 */
export async function checkTrackedDemo(
  projectRoot = process.cwd(),
  options: DemoBuildOptions = {},
): Promise<void> {
  const targets = trackedDemoPaths(projectRoot);
  const staged = await stageDemoArtifacts(options);
  try {
    const [storeDifferences, pageDifferences] = await Promise.all([
      compareArtifactTrees(staged.storeRoot, targets.storeRoot, "demo/store"),
      compareArtifactFile(staged.pagePath, targets.pagePath, "docs/index.html"),
    ]);
    const differences = [...storeDifferences, ...pageDifferences];
    if (differences.length > 0) {
      throw new Error(
        `Generated demo artifacts are out of date:\n${differences
          .map((difference) => `- ${difference}`)
          .join("\n")}`,
      );
    }
  } finally {
    await removeStaging(staged);
  }
}

export async function readBuiltDemoSnapshot(
  outputRoot: string,
): Promise<StoreSnapshot> {
  return readStore(demoArtifactPaths(outputRoot).storeRoot);
}
