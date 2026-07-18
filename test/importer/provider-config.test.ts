import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  apiKeyEnvForInit,
  loadProviderPreset,
  resolveProviderApiKey,
  resolveProviderConfig,
} from "../../src/importer/provider-config.js";

describe("resolveProviderConfig", () => {
  it("uses mock as the safe default", () => {
    expect(
      resolveProviderConfig({
        cliMock: false,
      }),
    ).toEqual({ provider: "mock", model: "mock" });
  });

  it("applies CLI, environment, preset precedence without inferring from keys", () => {
    const preset = {
      provider: "gemini" as const,
      model: "preset-model",
      apiKeyEnv: "CUSTOM_GEMINI_KEY",
    };

    expect(
      resolveProviderConfig({
        cliProvider: "openai",
        cliMock: false,
        cliModel: "cli-model",
        envProvider: "gemini",
        envModel: "env-model",
        preset,
      }),
    ).toEqual({
      provider: "openai",
      model: "cli-model",
      apiKeyEnv: "OPENAI_API_KEY",
    });

    expect(
      resolveProviderConfig({
        cliMock: false,
        envProvider: "gemini",
        envModel: "env-model",
        preset,
      }),
    ).toEqual({
      provider: "gemini",
      model: "env-model",
      apiKeyEnv: "CUSTOM_GEMINI_KEY",
    });
  });

  it("requires preset baseUrl and an explicit model for openai-compatible", () => {
    expect(() =>
      resolveProviderConfig({
        cliProvider: "openai-compatible",
        cliMock: false,
      }),
    ).toThrow(/requires an explicit model/);

    expect(() =>
      resolveProviderConfig({
        cliMock: false,
        preset: {
          provider: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
        },
      }),
    ).toThrow(/requires an explicit model/);

    expect(() =>
      resolveProviderConfig({
        cliProvider: "openai-compatible",
        cliMock: false,
        cliModel: "compat-model",
      }),
    ).toThrow(/requires baseUrl in \.local\/providers\.yaml/);

    expect(
      resolveProviderConfig({
        cliMock: false,
        preset: {
          provider: "openai-compatible",
          model: "compat-model",
          baseUrl: "https://api.example.com/v1",
          apiKeyEnv: "COMPAT_KEY",
        },
      }),
    ).toEqual({
      provider: "openai-compatible",
      model: "compat-model",
      apiKeyEnv: "COMPAT_KEY",
      baseUrl: "https://api.example.com/v1",
    });

    expect(
      resolveProviderConfig({
        cliProvider: "openai-compatible",
        cliMock: false,
        envModel: "env-compat-model",
        preset: {
          provider: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
        },
      }),
    ).toEqual({
      provider: "openai-compatible",
      model: "env-compat-model",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.example.com/v1",
    });

    expect(() =>
      resolveProviderConfig({
        cliProvider: "openai-compatible",
        cliMock: false,
        cliModel: "compat-model",
        preset: {
          provider: "gemini",
          model: "gemini-test",
          apiKeyEnv: "GEMINI_API_KEY",
        },
      }),
    ).toThrow(/requires baseUrl in \.local\/providers\.yaml/);
  });

  it("rejects unknown and contradictory provider selections", () => {
    expect(() =>
      resolveProviderConfig({ cliProvider: "unknown", cliMock: false }),
    ).toThrow(/mock, openai, gemini, openai-compatible/);
    expect(() =>
      resolveProviderConfig({ cliProvider: "gemini", cliMock: true }),
    ).toThrow(/conflicts/);
    expect(() =>
      resolveProviderConfig({
        cliMock: false,
        envProvider: "openai",
        envMock: "1",
      }),
    ).toThrow(/conflicts/);
  });
});

describe("apiKeyEnvForInit", () => {
  it("maps explicit live providers to their key variables", () => {
    expect(apiKeyEnvForInit("openai")).toBe("OPENAI_API_KEY");
    expect(apiKeyEnvForInit("gemini")).toBe("GEMINI_API_KEY");
    expect(apiKeyEnvForInit("openai-compatible")).toBe("OPENAI_API_KEY");
  });

  it("rejects absent, mock, and unknown providers", () => {
    expect(() => apiKeyEnvForInit(undefined)).toThrow(/select a live provider/);
    expect(() => apiKeyEnvForInit("mock")).toThrow(/select a live provider/);
    expect(() => apiKeyEnvForInit("other")).toThrow(
      /mock, openai, gemini, openai-compatible/,
    );
  });
});

describe("resolveProviderApiKey", () => {
  it("reads only the configured environment variable", () => {
    const config = {
      provider: "gemini" as const,
      model: "gemini-test",
      apiKeyEnv: "CUSTOM_GEMINI_KEY",
    };
    expect(
      resolveProviderApiKey(config, {
        GEMINI_API_KEY: "wrong-key",
        CUSTOM_GEMINI_KEY: "selected-key",
      }),
    ).toBe("selected-key");
    expect(() =>
      resolveProviderApiKey(config, { GEMINI_API_KEY: "wrong-key" }),
    ).toThrow("CUSTOM_GEMINI_KEY is required");
  });

  it("does not require a key for mock", () => {
    expect(
      resolveProviderApiKey({ provider: "mock", model: "mock" }, {}),
    ).toBeUndefined();
  });
});

describe("loadProviderPreset", () => {
  it("loads a strict local preset and allows an absent file", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "parallax-provider-"));
    await expect(loadProviderPreset(storeRoot)).resolves.toBeUndefined();

    await mkdir(join(storeRoot, ".local"));
    await writeFile(
      join(storeRoot, ".local", "providers.yaml"),
      "provider: gemini\nmodel: gemini-test\napiKeyEnv: CUSTOM_GEMINI_KEY\n",
    );

    await expect(loadProviderPreset(storeRoot)).resolves.toEqual({
      provider: "gemini",
      model: "gemini-test",
      apiKeyEnv: "CUSTOM_GEMINI_KEY",
    });
  });

  it("loads openai-compatible presets with baseUrl", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "parallax-provider-"));
    await mkdir(join(storeRoot, ".local"));
    await writeFile(
      join(storeRoot, ".local", "providers.yaml"),
      [
        "provider: openai-compatible",
        "model: local-model",
        "baseUrl: https://api.example.com/v1",
        "apiKeyEnv: COMPAT_KEY",
        "",
      ].join("\n"),
    );

    await expect(loadProviderPreset(storeRoot)).resolves.toEqual({
      provider: "openai-compatible",
      model: "local-model",
      baseUrl: "https://api.example.com/v1",
      apiKeyEnv: "COMPAT_KEY",
    });
  });

  it("rejects keys and unsupported provider configuration fields", async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), "parallax-provider-"));
    await mkdir(join(storeRoot, ".local"));
    const path = join(storeRoot, ".local", "providers.yaml");

    await writeFile(path, "provider: gemini\napiKey: secret-must-not-live-here\n");
    await expect(loadProviderPreset(storeRoot)).rejects.toThrow(
      /Only provider, model, apiKeyEnv, and baseUrl/,
    );

    await writeFile(path, "provider: openai-compatible\n");
    await expect(loadProviderPreset(storeRoot)).rejects.toThrow(
      /Only provider, model, apiKeyEnv, and baseUrl/,
    );

    await writeFile(path, "provider: gemini\nbaseUrl: https://api.example.com/v1\n");
    await expect(loadProviderPreset(storeRoot)).rejects.toThrow(
      /Only provider, model, apiKeyEnv, and baseUrl/,
    );
  });
});
