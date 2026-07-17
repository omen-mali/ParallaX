import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

import { StoreDigestSchema, type StoreDigest } from "../contract/types.js";
import { storePaths } from "./store.js";

export interface StoredDecision {
  id: string;
  title: string;
  decision: string;
  tags: string[];
  status: "active" | "superseded";
  createdAt: string;
}

export interface StoredTask {
  id: string;
  title: string;
  status: "open" | "done";
}

export interface StoreSnapshot {
  decisions: StoredDecision[];
  tasks: StoredTask[];
}

function splitFrontMatter(contents: string): {
  metadata: Record<string, unknown>;
  body: string;
} {
  const match = contents.match(/^---\n([\s\S]*?)---\n([\s\S]*)$/);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error("Expected valid YAML front matter.");
  }
  const metadata = parse(match[1]);
  if (metadata === null || typeof metadata !== "object") {
    throw new Error("Expected front matter to be an object.");
  }
  return { metadata: metadata as Record<string, unknown>, body: match[2] };
}

function heading(body: string, name: string): string | undefined {
  const match = body.match(
    new RegExp(`^## ${name}\\n\\n([\\s\\S]*?)(?=\\n## |$)`, "m"),
  );
  return match?.[1]?.trim();
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${field} to be a string.`);
  }
  return value;
}

async function readDecisions(projectRoot: string): Promise<StoredDecision[]> {
  const paths = storePaths(projectRoot);
  let entries: string[];
  try {
    entries = await readdir(paths.decisions);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const decisions = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".md"))
      .sort()
      .map(async (entry) => {
        const { metadata, body } = splitFrontMatter(
          await readFile(join(paths.decisions, entry), "utf8"),
        );
        const status = metadata.status;
        if (status !== "active" && status !== "superseded") {
          throw new Error(`Invalid decision status in ${entry}.`);
        }
        const validatedStatus: StoredDecision["status"] = status;
        const title = body.match(/^# (.+)$/m)?.[1];
        const decision = heading(body, "Decision");
        if (title === undefined || decision === undefined) {
          throw new Error(`Invalid decision body in ${entry}.`);
        }
        const tags = Array.isArray(metadata.tags)
          ? metadata.tags.filter((tag): tag is string => typeof tag === "string")
          : [];
        return {
          id: stringValue(metadata.id, "id"),
          title,
          decision,
          tags,
          status: validatedStatus,
          createdAt: stringValue(metadata.createdAt, "createdAt"),
        };
      }),
  );

  return decisions.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function readTasks(projectRoot: string): Promise<StoredTask[]> {
  let contents: string;
  try {
    contents = await readFile(storePaths(projectRoot).tasks, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const taskPattern =
    /<!-- PARALLAX:TASK\n([\s\S]*?)\n-->\n- \[([ x])\] (.+?)(?:\n|$)/g;
  return [...contents.matchAll(taskPattern)].map((match) => {
    const metadata = parse(match[1] ?? "");
    if (metadata === null || typeof metadata !== "object") {
      throw new Error("Invalid ParallaX task metadata.");
    }
    return {
      id: stringValue((metadata as Record<string, unknown>).id, "task id"),
      title: match[3] ?? "",
      status: match[2] === "x" ? "done" : "open",
    };
  });
}

export async function readStore(projectRoot: string): Promise<StoreSnapshot> {
  const [decisions, tasks] = await Promise.all([
    readDecisions(projectRoot),
    readTasks(projectRoot),
  ]);
  return { decisions, tasks };
}

export function toStoreDigest(snapshot: StoreSnapshot): StoreDigest {
  return StoreDigestSchema.parse({
    activeDecisions: snapshot.decisions
      .filter((decision) => decision.status === "active")
      .map(({ id, title, decision, tags }) => ({ id, title, decision, tags })),
    openTasks: snapshot.tasks
      .filter((task) => task.status === "open")
      .map(({ id, title }) => ({ id, title })),
    openQuestions: [],
    omittedRecordCount: 0,
  });
}
