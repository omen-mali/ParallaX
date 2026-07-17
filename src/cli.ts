#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { packageName } from "./index.js";
import { optionValue, positionalArguments } from "./cli-options.js";
import { compileContext, type CompileTarget } from "./compiler/compiler.js";
import {
  assertApiKeyNotPassedOnCli,
  createEnvFromTemplate,
  envFileExists,
  loadProjectEnv,
  writeApiKeyToEnv,
} from "./env.js";
import { parseGenericMarkdown } from "./importer/generic.js";
import { distillWithMock } from "./importer/mock-distiller.js";
import { distillWithOpenAI } from "./importer/openai-distiller.js";
import { verifyImportDelta } from "./importer/verify.js";
import { serveMcp } from "./mcp/server.js";
import {
  applyImport,
  formatProposal,
  initializeStore,
  resolveStoreRoot,
  sourceAlreadyImported,
} from "./store/store.js";
import { readStore, toStoreDigest } from "./store/read.js";
import { generateTimeline } from "./web/timeline.js";

const help = `ParallaX (${packageName})

Usage:
  parallax <command> [--root <path>] [--store <path>]

Commands:
  init       Create a .parallax project brain
             --env       Create .env from the template if absent
             --api-key   Prompt securely for OPENAI_API_KEY
  import     Distill a chat export into a reviewable proposal
             --metadata-only  Do not retain normalized transcript text
  compile    Render approved context for AI tools
  serve      Expose approved context over MCP
  web        Generate a static decision timeline

Store options:
  --root     Project root (default: current directory)
  --store    Store path relative to root (default: .parallax)
`;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(help);
    return;
  }

  const projectRoot = resolve(optionValue(args, "--root") ?? process.cwd());
  const storeRoot = resolveStoreRoot(
    projectRoot,
    optionValue(args, "--store") ?? undefined,
  );
  loadProjectEnv(projectRoot);

  if (command === "init") {
    assertApiKeyNotPassedOnCli(args);
    const paths = await initializeStore(storeRoot);
    process.stdout.write(`Initialized ${paths.root}\n`);

    const envExistedBefore = await envFileExists(projectRoot);

    if (args.includes("--env")) {
      const result = await createEnvFromTemplate(projectRoot);
      if (result.created) {
        process.stdout.write(`Created ${result.path}\n`);
      } else {
        process.stdout.write(`${result.path} already exists; leaving it unchanged.\n`);
      }
    }

    if (args.includes("--api-key")) {
      const result = await writeApiKeyToEnv({
        projectRoot,
        // Skip overwrite confirmation when this invocation created .env
        // (for example `init --env --api-key`).
        confirm: envExistedBefore ? undefined : async () => true,
      });
      if (result.written) {
        process.stdout.write(`Wrote OPENAI_API_KEY to ${result.path}\n`);
      } else {
        process.stdout.write(`Left ${result.path} unchanged.\n`);
      }
    }
    return;
  }

  if (command === "import") {
    const file = positionalArguments(args)[0];
    if (file === undefined) {
      throw new Error("Usage: parallax import <chat-export> [--apply] [--mock]");
    }
    const rawContents = await readFile(resolve(file), "utf8");
    const parsed = parseGenericMarkdown(rawContents, file);
    if (await sourceAlreadyImported(storeRoot, parsed.chat.id)) {
      throw new Error(`Source ${parsed.chat.id} was already imported.`);
    }

    const digest = toStoreDigest(await readStore(storeRoot));
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
        storeRoot,
        chat: parsed.chat,
        rawHash: parsed.rawHash,
        delta: verified,
        metadataOnly: args.includes("--metadata-only"),
      });
      process.stdout.write(`Applied proposal to ${storeRoot}\n`);
    } else {
      process.stdout.write("Preview only. Re-run with --apply to persist it.\n");
    }
    return;
  }

  if (command === "compile") {
    const requestedTarget = optionValue(args, "--target");
    const targets =
      requestedTarget === undefined ? undefined : [requestedTarget as CompileTarget];
    const compiled = await compileContext(projectRoot, storeRoot, targets);
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
    await generateTimeline(storeRoot, output);
    process.stdout.write(`Generated ${output}\n`);
    return;
  }

  if (command === "serve") {
    await serveMcp(storeRoot);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${help}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`parallax: ${message}\n`);
  process.exitCode = 1;
});
