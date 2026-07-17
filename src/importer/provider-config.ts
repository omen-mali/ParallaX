import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import type { LiveProviderId, ProviderId } from "./distiller.js";

const ProviderIdSchema = z.enum(["mock", "openai", "gemini"]);
const ApiKeyEnvSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

const ProviderPresetSchema = z
  .object({
    provider: ProviderIdSchema,
    model: z.string().min(1).optional(),
    apiKeyEnv: ApiKeyEnvSchema.optional(),
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
  });

export type ProviderPreset = z.infer<typeof ProviderPresetSchema>;

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  mock: "mock",
  openai: "gpt-5.6",
  gemini: "gemini-3.5-flash",
};

export const DEFAULT_API_KEY_ENV: Record<LiveProviderId, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export function parseProviderId(value: string, source: string): ProviderId {
  const result = ProviderIdSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${source} must be one of: mock, openai, gemini.`);
  }
  return result.data;
}

export function apiKeyEnvForInit(providerValue: string | undefined): string {
  if (providerValue === undefined) {
    throw new Error(
      "Use `init --provider openai|gemini --api-key` to select a live provider.",
    );
  }
  const provider = parseProviderId(providerValue, "--provider");
  if (provider === "mock") {
    throw new Error(
      "Use `init --provider openai|gemini --api-key` to select a live provider.",
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
      "Invalid .local/providers.yaml. Only provider, model, and apiKeyEnv are supported.",
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
  const model =
    options.cliModel ??
    options.envModel ??
    (options.preset?.provider === provider ? options.preset.model : undefined) ??
    DEFAULT_MODELS[provider];

  if (provider === "mock") {
    return { provider, model };
  }

  return {
    provider,
    model,
    apiKeyEnv:
      (options.preset?.provider === provider ? options.preset.apiKeyEnv : undefined) ??
      DEFAULT_API_KEY_ENV[provider],
  };
}
