#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { colorAllowed, renderBanner } from "./banner.js";
import { packageName, packageVersion } from "./index.js";
import { optionValue, positionalArguments } from "./cli-options.js";
import { compileContext, type CompileTarget } from "./compiler/compiler.js";
import {
  assertApiKeyNotPassedOnCli,
  createEnvFromTemplate,
  envFileExists,
  loadProjectEnv,
  writeApiKeyToEnv,
} from "./env.js";
import { parseChatGptConversations } from "./importer/chatgpt.js";
import { createDistiller } from "./importer/distillers.js";
import { parseGenericMarkdown, type ParsedChatExport } from "./importer/generic.js";
import {
  apiKeyEnvForInit,
  loadProviderPreset,
  resolveProviderApiKey,
  resolveProviderConfig,
} from "./importer/provider-config.js";
import { assertReviewTty, reviewImport } from "./importer/review.js";
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

const help = `ParallaX is a tool for distilling and reviewing chat exports, compiling approved context for AI tools, and generating static decision timelines.

Usage:
  parallax <command> [--root <path>] [--store <path>]

Commands:
  init       Create a .parallax project brain
             --env       Create .env from the template if absent
             --provider  Select openai, gemini, openai-compatible, or claude for --api-key
             --api-key   Prompt securely for the selected provider key
  import     Distill a chat export into a reviewable proposal
             --provider  Select mock, openai, gemini, openai-compatible, or claude (default: mock)
             --format    Select generic (default) or chatgpt
             --conversation  Required for a multi-chat ChatGPT export
             --metadata-only  Do not retain normalized transcript text
             --review    Select and apply proposal items interactively (TTY only; conflicts with --apply)
  compile    Render approved context for AI tools
  serve      Expose approved context over MCP
  web        Generate a static project-brain explorer
             --out       Output HTML path (default: docs/index.html)

Store options:
  --root     Project root (default: current directory)
  --store    Store path relative to root (default: .parallax)
`;

export interface CliIO {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}

export interface CliDependencies {
  createDistiller?: typeof createDistiller;
  reviewPrompt?: (question: string) => Promise<string>;
}

const defaultCliIO: CliIO = {
  stdin: process.stdin,
  stdout: process.stdout,
};

function parseImportExport(
  rawContents: string,
  file: string,
  args: string[],
): ParsedChatExport {
  const format = optionValue(args, "--format") ?? "generic";
  const conversation = optionValue(args, "--conversation");

  if (format === "generic") {
    if (conversation !== undefined) {
      throw new Error("--conversation is only valid with --format chatgpt.");
    }
    return parseGenericMarkdown(rawContents, file);
  }
  if (format === "chatgpt") {
    return parseChatGptConversations(rawContents, file, conversation);
  }
  throw new Error(`Unsupported import format: ${format}. Use generic or chatgpt.`);
}

function selectedItemCount(delta: {
  decisions: unknown[];
  tasks: unknown[];
  questions: unknown[];
  glossary: unknown[];
  specChanges: unknown[];
}): number {
  return (
    delta.decisions.length +
    delta.tasks.length +
    delta.questions.length +
    delta.glossary.length +
    delta.specChanges.length
  );
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  io: CliIO = defaultCliIO,
  dependencies: CliDependencies = {},
): Promise<void> {
  const [command, ...args] = argv;
  const { stdin, stdout } = io;
  if (command === undefined || command === "--help" || command === "-h") {
    stdout.write(
      renderBanner({ version: packageVersion, color: colorAllowed(stdout) }),
    );
    stdout.write(help);
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
    const apiKeyEnv = args.includes("--api-key")
      ? apiKeyEnvForInit(optionValue(args, "--provider"))
      : undefined;

    const paths = await initializeStore(storeRoot);
    stdout.write(`Initialized ${paths.root}\n`);

    const envExistedBefore = await envFileExists(projectRoot);

    if (args.includes("--env")) {
      const result = await createEnvFromTemplate(projectRoot);
      if (result.created) {
        stdout.write(`Created ${result.path}\n`);
      } else {
        stdout.write(`${result.path} already exists; leaving it unchanged.\n`);
      }
    }

    if (apiKeyEnv !== undefined) {
      const result = await writeApiKeyToEnv({
        projectRoot,
        apiKeyEnv,
        stdin,
        stdout,
        // Skip overwrite confirmation when this invocation created .env
        // (for example `init --env --api-key`).
        confirm: envExistedBefore ? undefined : async () => true,
      });
      if (result.written) {
        stdout.write(`Wrote ${apiKeyEnv} to ${result.path}\n`);
      } else {
        stdout.write(`Left ${result.path} unchanged.\n`);
      }
    }
    return;
  }

  if (command === "import") {
    const file = positionalArguments(args)[0];
    if (file === undefined) {
      throw new Error(
        "Usage: parallax import <chat-export> [--format generic|chatgpt] [--conversation <id>] [--provider mock|openai|gemini|openai-compatible|claude] [--apply|--review]",
      );
    }
    const review = args.includes("--review");
    const apply = args.includes("--apply");
    if (review && apply) {
      throw new Error("--review cannot be used with --apply.");
    }
    if (review) {
      assertReviewTty(stdin, stdout);
    }

    const rawContents = await readFile(resolve(file), "utf8");
    const parsed = parseImportExport(rawContents, file, args);
    if (await sourceAlreadyImported(storeRoot, parsed.chat.id)) {
      throw new Error(`Source ${parsed.chat.id} was already imported.`);
    }

    const digest = toStoreDigest(await readStore(storeRoot));
    const providerConfig = resolveProviderConfig({
      cliProvider: optionValue(args, "--provider"),
      cliMock: args.includes("--mock"),
      cliModel: optionValue(args, "--model"),
      envProvider: process.env.PARALLAX_PROVIDER,
      envMock: process.env.PARALLAX_MOCK,
      envModel: process.env.PARALLAX_MODEL,
      preset: await loadProviderPreset(storeRoot),
    });
    const distiller = await (dependencies.createDistiller ?? createDistiller)(
      providerConfig.provider,
    );
    const candidate = await distiller.distill(parsed.chat, digest, {
      model: providerConfig.model,
      apiKey: resolveProviderApiKey(providerConfig, process.env),
      baseUrl: providerConfig.baseUrl,
    });
    const verified = verifyImportDelta(candidate, parsed.chat, digest);

    if (review) {
      const selected = await reviewImport(verified, {
        input: stdin,
        output: stdout,
        prompt: dependencies.reviewPrompt,
      });
      if (selected === undefined) {
        return;
      }
      await applyImport({
        storeRoot,
        chat: parsed.chat,
        rawHash: parsed.rawHash,
        delta: selected,
        metadataOnly: args.includes("--metadata-only"),
      });
      const count = selectedItemCount(selected);
      const suffix = count === 1 ? "item" : "items";
      stdout.write(`Applied ${count} selected ${suffix} to ${storeRoot}\n`);
      return;
    }

    stdout.write(formatProposal(parsed.chat, verified));

    if (apply) {
      await applyImport({
        storeRoot,
        chat: parsed.chat,
        rawHash: parsed.rawHash,
        delta: verified,
        metadataOnly: args.includes("--metadata-only"),
      });
      stdout.write(`Applied proposal to ${storeRoot}\n`);
    } else {
      stdout.write("Preview only. Re-run with --apply to persist it.\n");
    }
    return;
  }

  if (command === "compile") {
    const requestedTarget = optionValue(args, "--target");
    const targets =
      requestedTarget === undefined ? undefined : [requestedTarget as CompileTarget];
    const compiled = await compileContext(projectRoot, storeRoot, targets);
    for (const { path } of compiled) {
      stdout.write(`Compiled ${path}\n`);
    }
    return;
  }

  if (command === "web") {
    const output = resolve(
      projectRoot,
      optionValue(args, "--out") ?? "docs/index.html",
    );
    await generateTimeline(storeRoot, output);
    stdout.write(`Generated ${output}\n`);
    return;
  }

  if (command === "serve") {
    await serveMcp(storeRoot);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${help}`);
}

function isDirectCliInvocation(): boolean {
  const entryPoint = process.argv[1];
  if (entryPoint === undefined) {
    return false;
  }

  try {
    return (
      realpathSync(resolve(entryPoint)) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isDirectCliInvocation()) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`parallax: ${message}\n`);
    process.exitCode = 1;
  });
}
