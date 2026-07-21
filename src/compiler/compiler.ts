import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readStore, type StoreSnapshot } from "../store/read.js";

export const BEGIN_MARKER = "<!-- PARALLAX:BEGIN v=1 -->";
export const END_MARKER = "<!-- PARALLAX:END -->";

export type CompileTarget = "agents" | "claude" | "cursor";

interface TargetDefinition {
  target: CompileTarget;
  relativePath: string;
  createdPrefix: string;
}

const TARGETS: TargetDefinition[] = [
  { target: "agents", relativePath: "AGENTS.md", createdPrefix: "" },
  { target: "claude", relativePath: "CLAUDE.md", createdPrefix: "" },
  {
    target: "cursor",
    relativePath: ".cursor/rules/parallax.mdc",
    createdPrefix:
      "---\ndescription: ParallaX generated project context\nalwaysApply: true\n---",
  },
];

function lineEnding(value: string): "\n" | "\r\n" {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

function markerCount(value: string, marker: string): number {
  return value.split(marker).length - 1;
}

/**
 * Replaces only a single valid managed region. All characters outside it are
 * copied exactly from the input string.
 */
export function replaceManagedBlock(existing: string, managedContent: string): string {
  const begins = markerCount(existing, BEGIN_MARKER);
  const ends = markerCount(existing, END_MARKER);
  const newline = lineEnding(existing);
  const block = `${BEGIN_MARKER}${newline}${managedContent}${newline}${END_MARKER}`;

  if (begins === 0 && ends === 0) {
    if (existing.length === 0) {
      return block;
    }
    const separator = existing.endsWith("\n") ? newline : `${newline}${newline}`;
    return `${existing}${separator}${block}${newline}`;
  }

  if (begins !== 1 || ends !== 1) {
    throw new Error("Expected exactly one PARALLAX begin and end marker.");
  }

  const beginIndex = existing.indexOf(BEGIN_MARKER);
  const endIndex = existing.indexOf(END_MARKER);
  if (endIndex < beginIndex) {
    throw new Error("PARALLAX end marker appears before its begin marker.");
  }

  return `${existing.slice(0, beginIndex)}${block}${existing.slice(
    endIndex + END_MARKER.length,
  )}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function renderContext(snapshot: StoreSnapshot): string {
  const lines = ["# ParallaX Project Context"];
  const activeDecisions = snapshot.decisions.filter(
    (decision) => decision.status === "active",
  );
  const openTasks = snapshot.tasks.filter((task) => task.status === "open");

  lines.push("", "## Active decisions");
  if (activeDecisions.length === 0) {
    lines.push("- None recorded yet.");
  } else {
    for (const decision of activeDecisions) {
      const tags = decision.tags.length === 0 ? "" : ` [${decision.tags.join(", ")}]`;
      lines.push(`- ${decision.title}${tags}: ${truncate(decision.decision, 500)}`);
    }
  }

  lines.push("", "## Open tasks");
  if (openTasks.length === 0) {
    lines.push("- None recorded yet.");
  } else {
    for (const task of openTasks) {
      lines.push(`- ${task.title}`);
    }
  }

  const rendered = lines.join("\n");
  return truncate(rendered, 8000);
}

async function readExisting(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export interface CompiledFile {
  target: CompileTarget;
  path: string;
}

export async function compileContext(
  projectRoot: string,
  storeRoot: string,
  targets: CompileTarget[] = TARGETS.map(({ target }) => target),
): Promise<CompiledFile[]> {
  const snapshot = await readStore(storeRoot);
  const managedContent = renderContext(snapshot);
  const selectedTargets = TARGETS.filter(({ target }) => targets.includes(target));
  if (selectedTargets.length !== targets.length) {
    throw new Error("Unknown compile target.");
  }

  const changes = await Promise.all(
    selectedTargets.map(async (target) => {
      const path = join(projectRoot, target.relativePath);
      const existing = await readExisting(path);
      const contents = replaceManagedBlock(
        existing ?? target.createdPrefix,
        managedContent,
      );
      return { ...target, path, contents };
    }),
  );

  await Promise.all(
    changes.map(async ({ path, contents }) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, "utf8");
    }),
  );

  return changes.map(({ target, path }) => ({ target, path }));
}
