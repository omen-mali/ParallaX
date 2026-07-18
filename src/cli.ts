#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApplicationServices } from "./application/services.js";
import { colorAllowed, renderBanner } from "./banner.js";
import { packageName, packageVersion } from "./index.js";
import { optionValue, positionalArguments } from "./cli-options.js";
import type { CompileTarget } from "./compiler/compiler.js";
import {
  assertApiKeyNotPassedOnCli,
  createEnvFromTemplate,
  envFileExists,
  writeApiKeyToEnv,
} from "./env.js";
import { createDistiller } from "./importer/distillers.js";
import { apiKeyEnvForInit } from "./importer/provider-config.js";
import { assertReviewTty, reviewImport } from "./importer/review.js";
import { serveMcp } from "./mcp/server.js";
import { formatProposal, initializeStore, resolveStoreRoot } from "./store/store.js";
import { startUiServer } from "./ui/server.js";
import { generateTimelineFromSnapshot } from "./web/timeline.js";

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
  ui         Open a loopback-only local browser interface
             --provider  Initial provider choice; the browser can choose provider and model per preview
             --mock      Start with the deterministic mock provider
             --model     Initial provider model

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
  createApplicationServices?: typeof createApplicationServices;
  startUiServer?: typeof startUiServer;
}

const defaultCliIO: CliIO = {
  stdin: process.stdin,
  stdout: process.stdout,
};

function importFormat(args: string[]): "generic" | "chatgpt" {
  const format = optionValue(args, "--format") ?? "generic";
  if (format !== "generic" && format !== "chatgpt") {
    throw new Error(`Unsupported import format: ${format}. Use generic or chatgpt.`);
  }
  return format;
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  io: CliIO = defaultCliIO,
  dependencies: CliDependencies = {},
): Promise<void> {
  // pnpm 11 forwards a separator written as `pnpm run dev -- ui` to the
  // script. Accept it for callers accustomed to npm-style forwarding, while
  // documentation uses the simpler `pnpm run dev ui` form.
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...args] = normalizedArgv;
  const { stdin, stdout } = io;
  if (command === undefined || command === "--help" || command === "-h") {
    stdout.write(
      renderBanner({ version: packageVersion, color: colorAllowed(stdout) }),
    );
    stdout.write(help);
    return;
  }

  const projectRoot = resolve(optionValue(args, "--root") ?? process.cwd());
  const storePath = optionValue(args, "--store") ?? undefined;
  const storeRoot = resolveStoreRoot(projectRoot, storePath);
  const applicationServices = (
    serviceOptions: { respectMockEnvironment?: boolean } = {},
  ) =>
    (dependencies.createApplicationServices ?? createApplicationServices)({
      projectRoot,
      storePath,
      provider: optionValue(args, "--provider"),
      mock: args.includes("--mock"),
      model: optionValue(args, "--model"),
      createDistiller: dependencies.createDistiller,
      ...serviceOptions,
    });

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
    const services = applicationServices();
    const prepared = await services.prepareImport({
      contents: rawContents,
      fileName: file,
      format: importFormat(args),
      conversationId: optionValue(args, "--conversation"),
      provider: optionValue(args, "--provider"),
      mock: args.includes("--mock"),
      model: optionValue(args, "--model"),
    });

    if (review) {
      const selected = await reviewImport(prepared.delta, {
        input: stdin,
        output: stdout,
        prompt: dependencies.reviewPrompt,
      });
      if (selected === undefined) {
        return;
      }
      const applied = await services.applyPreparedImport(prepared, {
        selectedDelta: selected,
        metadataOnly: args.includes("--metadata-only"),
      });
      const count = applied.appliedCount;
      const suffix = count === 1 ? "item" : "items";
      stdout.write(`Applied ${count} selected ${suffix} to ${storeRoot}\n`);
      return;
    }

    stdout.write(formatProposal(prepared.chat, prepared.delta));

    if (apply) {
      await services.applyPreparedImport(prepared, {
        metadataOnly: args.includes("--metadata-only"),
      });
      stdout.write(`Applied proposal to ${storeRoot}\n`);
    } else {
      stdout.write("Preview only. Re-run with --apply to persist it.\n");
    }
    return;
  }

  if (command === "compile") {
    const services = applicationServices();
    const requestedTarget = optionValue(args, "--target");
    const targets =
      requestedTarget === undefined ? undefined : [requestedTarget as CompileTarget];
    const compiled = await services.compile({ targets });
    for (const { path } of compiled) {
      stdout.write(`Compiled ${path}\n`);
    }
    return;
  }

  if (command === "web") {
    const services = applicationServices();
    const output = resolve(
      projectRoot,
      optionValue(args, "--out") ?? "docs/index.html",
    );
    await generateTimelineFromSnapshot(await services.readSnapshot(), output);
    stdout.write(`Generated ${output}\n`);
    return;
  }

  if (command === "serve") {
    await serveMcp(applicationServices());
    return;
  }

  if (command === "ui") {
    const services = applicationServices({ respectMockEnvironment: true });
    // Validate launch-scoped provider configuration before opening a browser.
    // API-key lookup remains deferred until the user explicitly previews.
    await services.getUiConfig();
    await (dependencies.startUiServer ?? startUiServer)({
      applicationServices: services,
    });
    stdout.write("Opened ParallaX local UI in the system browser.\n");
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
