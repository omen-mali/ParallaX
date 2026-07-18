import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import type {
  LiveProviderId,
  ProviderId,
  ProvidersRequiringExplicitModel,
} from "./distiller.js";

const ProviderIdSchema = z.enum([
  "mock",
  "openai",
  "gemini",
  "openai-compatible",
  "claude",
]);
const ApiKeyEnvSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

/**
 * Endpoint URLs for openai-compatible: http(s) only, no embedded credentials.
 */
export function parseCompatibleBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("baseUrl must be a valid http or https URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("baseUrl must use the http or https scheme.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("baseUrl must not include embedded credentials.");
  }
  return value;
}

const BaseUrlSchema = z.string().superRefine((value, context) => {
  try {
    parseCompatibleBaseUrl(value);
  } catch (error: unknown) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid baseUrl.",
    });
  }
});

const ProviderPresetSchema = z
  .object({
    provider: ProviderIdSchema,
    model: z.string().min(1).optional(),
    apiKeyEnv: ApiKeyEnvSchema.optional(),
    baseUrl: BaseUrlSchema.optional(),
  })
  .strict()
  .superRefine((preset, context) => {
    if (preset.provider === "mock" && preset.apiKeyEnv !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["apiKeyEnv"],
        message: "Mock provider cannot use an API key.",
      });
    }
    if (preset.provider === "openai-compatible" && preset.baseUrl === undefined) {
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "openai-compatible requires baseUrl.",
      });
    }
    if (preset.provider !== "openai-compatible" && preset.baseUrl !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "baseUrl is only supported for openai-compatible.",
      });
    }
  });

export type ProviderPreset = z.infer<typeof ProviderPresetSchema>;

/** Defaults for providers with a known first-party model. */
export const DEFAULT_MODELS: Record<
  Exclude<ProviderId, ProvidersRequiringExplicitModel>,
  string
> = {
  mock: "mock",
  openai: "gpt-5.6",
  gemini: "gemini-3.5-flash",
};

export const DEFAULT_API_KEY_ENV: Record<LiveProviderId, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  "openai-compatible": "OPENAI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
};

const PROVIDER_LIST = "mock, openai, gemini, openai-compatible, claude";

function requiresExplicitModel(
  provider: ProviderId,
): provider is ProvidersRequiringExplicitModel {
  return provider === "openai-compatible" || provider === "claude";
}

export function parseProviderId(value: string, source: string): ProviderId {
  const result = ProviderIdSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${source} must be one of: ${PROVIDER_LIST}.`);
  }
  return result.data;
}

export function apiKeyEnvForInit(providerValue: string | undefined): string {
  if (providerValue === undefined) {
    throw new Error(
      "Use `init --provider openai|gemini|openai-compatible|claude --api-key` to select a live provider.",
    );
  }
  const provider = parseProviderId(providerValue, "--provider");
  if (provider === "mock") {
    throw new Error(
      "Use `init --provider openai|gemini|openai-compatible|claude --api-key` to select a live provider.",
    );
  }
  return DEFAULT_API_KEY_ENV[provider];
}

export async function loadProviderPreset(
  storeRoot: string,
): Promise<ProviderPreset | undefined> {
  const path = join(storeRoot, ".local", "providers.yaml");
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new Error("Unable to read local provider configuration.");
  }

  try {
    return ProviderPresetSchema.parse(parse(contents));
  } catch {
    throw new Error(
      "Invalid .local/providers.yaml. Only provider, model, apiKeyEnv, and baseUrl are supported.",
    );
  }
}

export interface ResolveProviderConfigOptions {
  cliProvider?: string;
  cliMock: boolean;
  cliModel?: string;
  envProvider?: string;
  envMock?: string;
  envModel?: string;
  preset?: ProviderPreset;
}

export interface ResolvedProviderConfig {
  provider: ProviderId;
  model: string;
  apiKeyEnv?: string;
  baseUrl?: string;
}

export function resolveProviderApiKey(
  config: ResolvedProviderConfig,
  environment: NodeJS.ProcessEnv,
): string | undefined {
  if (config.provider === "mock") {
    return undefined;
  }
  const apiKeyEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV[config.provider];
  const apiKey = environment[apiKeyEnv];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(`${apiKeyEnv} is required for the ${config.provider} provider.`);
  }
  return apiKey;
}

export function resolveProviderConfig(
  options: ResolveProviderConfigOptions,
): ResolvedProviderConfig {
  const cliProvider =
    options.cliProvider === undefined
      ? undefined
      : parseProviderId(options.cliProvider, "--provider");
  const envProvider =
    options.envProvider === undefined || options.envProvider.length === 0
      ? undefined
      : parseProviderId(options.envProvider, "PARALLAX_PROVIDER");
  const envMock = options.envMock === "1";

  if (options.cliMock && cliProvider !== undefined && cliProvider !== "mock") {
    throw new Error("--mock conflicts with a live --provider.");
  }
  if (envMock && envProvider !== undefined && envProvider !== "mock") {
    throw new Error("PARALLAX_MOCK conflicts with a live PARALLAX_PROVIDER.");
  }

  const provider =
    cliProvider ??
    (options.cliMock ? "mock" : undefined) ??
    envProvider ??
    (envMock ? "mock" : undefined) ??
    options.preset?.provider ??
    "mock";
  const explicitModel =
    options.cliModel ??
    options.envModel ??
    (options.preset?.provider === provider ? options.preset.model : undefined);

  if (requiresExplicitModel(provider)) {
    if (explicitModel === undefined || explicitModel.length === 0) {
      throw new Error(
        `${provider} requires an explicit model via --model, PARALLAX_MODEL, or .local/providers.yaml.`,
      );
    }
  }

  const model =
    explicitModel ??
    DEFAULT_MODELS[provider as Exclude<ProviderId, ProvidersRequiringExplicitModel>];

  if (provider === "mock") {
    return { provider, model };
  }

  const presetMatches = options.preset?.provider === provider;
  const baseUrl = presetMatches ? options.preset?.baseUrl : undefined;

  if (provider === "openai-compatible" && baseUrl === undefined) {
    throw new Error("openai-compatible requires baseUrl in .local/providers.yaml.");
  }

  return {
    provider,
    model,
    apiKeyEnv:
      (presetMatches ? options.preset?.apiKeyEnv : undefined) ??
      DEFAULT_API_KEY_ENV[provider],
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
}
