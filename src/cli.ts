#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { packageName } from "./index.js";
import { compileContext, type CompileTarget } from "./compiler/compiler.js";
import { parseGenericMarkdown } from "./importer/generic.js";
import { distillWithMock } from "./importer/mock-distiller.js";
import { distillWithOpenAI } from "./importer/openai-distiller.js";
import { verifyImportDelta } from "./importer/verify.js";
import { serveMcp } from "./mcp/server.js";
import {
  applyImport,
  formatProposal,
  initializeStore,
  sourceAlreadyImported,
} from "./store/store.js";
import { readStore, toStoreDigest } from "./store/read.js";
import { generateTimeline } from "./web/timeline.js";

const help = `ParallaX (${packageName})

Usage:
  parallax <command>

Commands:
  init       Create a .parallax project brain
  import     Distill a chat export into a reviewable proposal
  compile    Render approved context for AI tools
  serve      Expose approved context over MCP
  web        Generate a static decision timeline
`;

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(help);
    return;
  }

  const projectRoot = resolve(optionValue(args, "--root") ?? process.cwd());
  if (command === "init") {
    const paths = await initializeStore(projectRoot);
    process.stdout.write(`Initialized ${paths.root}\n`);
    return;
  }

  if (command === "import") {
    const file = args.find(
      (argument, index) => !argument.startsWith("--") && args[index - 1] !== "--root",
    );
    if (file === undefined) {
      throw new Error("Usage: parallax import <chat-export> [--apply] [--mock]");
    }
    const rawContents = await readFile(resolve(file), "utf8");
    const parsed = parseGenericMarkdown(rawContents, file);
    if (await sourceAlreadyImported(projectRoot, parsed.chat.id)) {
      throw new Error(`Source ${parsed.chat.id} was already imported.`);
    }

    const digest = toStoreDigest(await readStore(projectRoot));
    const mockMode = process.env.PARALLAX_MOCK === "1" || args.includes("--mock");
    const candidate = mockMode
      ? distillWithMock(parsed.chat)
      : await distillWithOpenAI(parsed.chat, digest, {
          model: optionValue(args, "--model"),
        });
    const verified = verifyImportDelta(candidate, parsed.chat, digest);
    process.stdout.write(formatProposal(parsed.chat, verified));

    if (args.includes("--apply")) {
      await applyImport({
        projectRoot,
        chat: parsed.chat,
        rawHash: parsed.rawHash,
        delta: verified,
        metadataOnly: args.includes("--metadata-only"),
      });
      process.stdout.write("Applied proposal to .parallax/\n");
    } else {
      process.stdout.write("Preview only. Re-run with --apply to persist it.\n");
    }
    return;
  }

  if (command === "compile") {
    const requestedTarget = optionValue(args, "--target");
    const targets =
      requestedTarget === undefined ? undefined : [requestedTarget as CompileTarget];
    const compiled = await compileContext(projectRoot, targets);
    for (const { path } of compiled) {
      process.stdout.write(`Compiled ${path}\n`);
    }
    return;
  }

  if (command === "web") {
    const output = resolve(
      projectRoot,
      optionValue(args, "--out") ?? "docs/index.html",
    );
    await generateTimeline(projectRoot, output);
    process.stdout.write(`Generated ${output}\n`);
    return;
  }

  if (command === "serve") {
    await serveMcp(projectRoot);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${help}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`parallax: ${message}\n`);
  process.exitCode = 1;
});
