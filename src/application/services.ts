import { resolve } from "node:path";

import {
  compileContext,
  type CompileTarget,
  type CompiledFile,
} from "../compiler/compiler.js";
import type { NormalizedChat } from "../contract/types.js";
import { loadProjectEnv } from "../env.js";
import {
  listChatGptConversations,
  parseChatGptConversations,
  type ChatGptConversationSummary,
} from "../importer/chatgpt.js";
import type { Distiller, ProviderId } from "../importer/distiller.js";
import { createDistiller } from "../importer/distillers.js";
import { parseGenericMarkdown } from "../importer/generic.js";
import {
  filterProposalSelection,
  proposalItems,
  selectionKeysForFilteredDelta,
  validateProposalKeys,
  type ProposalItem,
} from "../importer/proposal.js";
import {
  loadProviderPreset,
  resolveProviderApiKey,
  resolveProviderConfig,
  type ResolvedProviderConfig,
} from "../importer/provider-config.js";
import type { VerifiedImportDelta } from "../importer/verify.js";
import { verifyImportDelta } from "../importer/verify.js";
import { readStore, toStoreDigest, type StoreSnapshot } from "../store/read.js";
import {
  applyImport,
  resolveStoreRoot,
  sourceAlreadyImported,
} from "../store/store.js";

export type ImportFormat = "generic" | "chatgpt";

export interface ImportProviderSelection {
  provider?: string;
  mock?: boolean;
  model?: string;
}

export interface PrepareImportInput extends ImportProviderSelection {
  contents: string;
  fileName?: string;
  format: ImportFormat;
  conversationId?: string;
}

export interface PreparedImport {
  chat: NormalizedChat;
  rawHash: string;
  delta: VerifiedImportDelta;
  provider: Pick<ResolvedProviderConfig, "provider" | "model">;
  items: ProposalItem[];
}

export interface ApplyPreparedImportOptions {
  metadataOnly?: boolean;
  selectedKeys?: readonly string[];
  /** Compatibility path for the existing TTY reviewer. */
  selectedDelta?: VerifiedImportDelta;
  appliedAt?: string;
}

export interface ApplicationServicesOptions extends ImportProviderSelection {
  projectRoot?: string;
  storePath?: string;
  environment?: NodeJS.ProcessEnv;
  createDistiller?: typeof createDistiller;
  /** UI-only: honor PARALLAX_MOCK as a forced, zero-network launch mode. */
  respectMockEnvironment?: boolean;
}

export interface UiConfiguration {
  providers: readonly ProviderId[];
  provider: ProviderId;
  model: string;
  mock: boolean;
  mockLocked: boolean;
}

export interface ApplicationServices {
  readonly projectRoot: string;
  readonly storeRoot: string;
  getUiConfig(): Promise<UiConfiguration>;
  inspectChatGpt(input: {
    contents: string;
    fileName?: string;
  }): Promise<ChatGptConversationSummary[]>;
  prepareImport(input: PrepareImportInput): Promise<PreparedImport>;
  applyPreparedImport(
    prepared: PreparedImport,
    options?: ApplyPreparedImportOptions,
  ): Promise<{ appliedCount: number }>;
  readSnapshot(): Promise<StoreSnapshot>;
  compile(options?: { targets?: CompileTarget[] }): Promise<CompiledFile[]>;
}

function parseImport(input: PrepareImportInput): {
  chat: NormalizedChat;
  rawHash: string;
} {
  const fileName = input.fileName ?? "chat.md";
  if (input.format === "generic") {
    if (input.conversationId !== undefined) {
      throw new Error("--conversation is only valid with --format chatgpt.");
    }
    return parseGenericMarkdown(input.contents, fileName);
  }
  return parseChatGptConversations(input.contents, fileName, input.conversationId);
}

function selectionForInput(
  options: ApplicationServicesOptions,
  input: ImportProviderSelection | undefined,
  mockLocked: boolean,
): ImportProviderSelection {
  if (mockLocked) {
    return { provider: "mock", mock: true, model: "mock" };
  }
  if (input?.provider !== undefined) {
    return {
      provider: input.provider,
      model: input.model,
      // A deliberate browser provider selection is equivalent to CLI provider
      // selection and takes precedence over a launch mock default.
      mock: input.mock ?? false,
    };
  }
  return {
    provider: options.provider,
    mock: input?.mock ?? options.mock ?? false,
    model: input?.model ?? options.model,
  };
}

export function createApplicationServices(
  options: ApplicationServicesOptions = {},
): ApplicationServices {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const storeRoot = resolveStoreRoot(projectRoot, options.storePath);
  const environment = options.environment ?? process.env;
  const makeDistiller = options.createDistiller ?? createDistiller;

  // Match the CLI's project-scoped .env behavior. Existing shell variables
  // retain precedence through dotenv's non-overriding load.
  loadProjectEnv(projectRoot);
  const mockLocked =
    options.mock === true ||
    (options.respectMockEnvironment === true && environment.PARALLAX_MOCK === "1");

  const resolveProvider = async (
    selection?: ImportProviderSelection,
  ): Promise<ResolvedProviderConfig> => {
    const selected = selectionForInput(options, selection, mockLocked);
    const preset = await loadProviderPreset(storeRoot);
    return resolveProviderConfig({
      cliProvider: selected.provider,
      cliMock: selected.mock ?? false,
      cliModel: selected.model,
      envProvider: environment.PARALLAX_PROVIDER,
      envMock: environment.PARALLAX_MOCK,
      envModel: environment.PARALLAX_MODEL,
      preset,
    });
  };

  return {
    projectRoot,
    storeRoot,

    async getUiConfig(): Promise<UiConfiguration> {
      const [config, preset] = await Promise.all([
        resolveProvider(),
        loadProviderPreset(storeRoot),
      ]);
      if (mockLocked) {
        // A forced mock launch ignores untrusted browser overrides, but it must
        // still preserve the CLI resolver's validation for conflicting launch
        // flags and environment configuration.
        resolveProviderConfig({
          cliProvider: options.provider,
          cliMock: options.mock ?? false,
          cliModel: options.model,
          envProvider: environment.PARALLAX_PROVIDER,
          envMock: environment.PARALLAX_MOCK,
          envModel: environment.PARALLAX_MODEL,
          preset,
        });
      }
      const providers: ProviderId[] = ["mock", "openai", "gemini", "claude"];
      if (preset?.provider === "openai-compatible" && preset.baseUrl !== undefined) {
        providers.splice(3, 0, "openai-compatible");
      }
      if (!providers.includes(config.provider)) {
        providers.push(config.provider);
      }
      return {
        providers,
        provider: config.provider,
        model: config.model,
        mock: config.provider === "mock",
        mockLocked,
      };
    },

    async inspectChatGpt(input): Promise<ChatGptConversationSummary[]> {
      return listChatGptConversations(input.contents, input.fileName);
    },

    async prepareImport(input): Promise<PreparedImport> {
      const parsed = parseImport(input);
      if (await sourceAlreadyImported(storeRoot, parsed.chat.id)) {
        throw new Error(`Source ${parsed.chat.id} was already imported.`);
      }

      const [snapshot, provider] = await Promise.all([
        readStore(storeRoot),
        resolveProvider(input),
      ]);
      const distiller: Distiller = await makeDistiller(provider.provider);
      const candidate = await distiller.distill(parsed.chat, toStoreDigest(snapshot), {
        model: provider.model,
        apiKey: resolveProviderApiKey(provider, environment),
        baseUrl: provider.baseUrl,
      });
      const delta = verifyImportDelta(candidate, parsed.chat, toStoreDigest(snapshot));
      return {
        chat: parsed.chat,
        rawHash: parsed.rawHash,
        delta,
        provider: { provider: provider.provider, model: provider.model },
        items: proposalItems(delta),
      };
    },

    async applyPreparedImport(
      prepared,
      applyOptions = {},
    ): Promise<{ appliedCount: number }> {
      let delta = prepared.delta;
      if (
        applyOptions.selectedKeys !== undefined ||
        applyOptions.selectedDelta !== undefined
      ) {
        const keys =
          applyOptions.selectedKeys ??
          selectionKeysForFilteredDelta(prepared.delta, applyOptions.selectedDelta!);
        if (keys.length === 0) {
          throw new Error("Select at least one proposal item before applying.");
        }
        delta = filterProposalSelection(
          prepared.delta,
          validateProposalKeys(prepared.delta, keys),
        );
      }

      await applyImport({
        storeRoot,
        chat: prepared.chat,
        rawHash: prepared.rawHash,
        delta,
        metadataOnly: applyOptions.metadataOnly ?? false,
        ...(applyOptions.appliedAt === undefined
          ? {}
          : { appliedAt: applyOptions.appliedAt }),
      });
      return { appliedCount: proposalItems(delta).length };
    },

    readSnapshot: () => readStore(storeRoot),

    compile: (compileOptions = {}) =>
      compileContext(projectRoot, storeRoot, compileOptions.targets),
  };
}
