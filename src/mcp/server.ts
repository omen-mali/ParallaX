import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { renderContext } from "../compiler/compiler.js";
import { readStore, type StoreSnapshot } from "../store/read.js";

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export interface SearchResult {
  kind: "decision" | "task";
  id: string;
  title: string;
  score: number;
}

export function searchSnapshot(snapshot: StoreSnapshot, query: string): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [];
  }

  const score = (title: string, body: string, tags = "") => {
    const normalizedTitle = title.toLowerCase();
    const normalizedBody = body.toLowerCase();
    const normalizedTags = tags.toLowerCase();
    return terms.reduce((total, term) => {
      const exactTitle = normalizedTitle.includes(term) ? 4 : 0;
      const exactTag = normalizedTags.includes(term) ? 3 : 0;
      const bodyMatch = normalizedBody.includes(term) ? 1 : 0;
      return total + exactTitle + exactTag + bodyMatch;
    }, 0);
  };

  const results: SearchResult[] = [
    ...snapshot.decisions.map((decision) => ({
      kind: "decision" as const,
      id: decision.id,
      title: decision.title,
      score: score(decision.title, decision.decision, decision.tags.join(" ")),
    })),
    ...snapshot.tasks.map((task) => ({
      kind: "task" as const,
      id: task.id,
      title: task.title,
      score: score(task.title, task.title),
    })),
  ];

  return results
    .filter((result) => result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.title.localeCompare(right.title),
    );
}

export function createMcpServer(projectRoot: string): McpServer {
  const server = new McpServer({ name: "parallax", version: "0.1.0" });

  server.registerTool(
    "get_context",
    {
      description: "Get concise approved project context from the ParallaX store.",
    },
    async () => textResult({ context: renderContext(await readStore(projectRoot)) }),
  );

  server.registerTool(
    "search",
    {
      description: "Search approved decisions and tasks with lexical scoring.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) =>
      textResult(searchSnapshot(await readStore(projectRoot), query)),
  );

  server.registerTool(
    "get_decision",
    {
      description: "Get one approved decision by its ParallaX ID.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const decision = (await readStore(projectRoot)).decisions.find(
        (candidate) => candidate.id === id,
      );
      if (decision === undefined) {
        return {
          content: [{ type: "text" as const, text: `No decision found for ID ${id}.` }],
          isError: true,
        };
      }
      return textResult(decision);
    },
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List approved ParallaX tasks.",
      inputSchema: { status: z.enum(["open", "done"]).optional() },
    },
    async ({ status }) => {
      const tasks = (await readStore(projectRoot)).tasks.filter(
        (task) => status === undefined || task.status === status,
      );
      return textResult(tasks);
    },
  );

  return server;
}

export async function serveMcp(projectRoot: string): Promise<void> {
  const server = createMcpServer(projectRoot);
  await server.connect(new StdioServerTransport());
}
