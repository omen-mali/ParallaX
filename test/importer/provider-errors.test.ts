import { describe, expect, it } from "vitest";

import {
  mapProviderDistillationError,
  ProviderAuthError,
  ProviderError,
  ProviderMalformedOutputError,
  ProviderModelUnavailableError,
  ProviderRateLimitError,
  ProviderRefusalError,
  ProviderUnavailableError,
} from "../../src/importer/provider-errors.js";
import { parseProviderOutput } from "../../src/importer/distiller.js";

const sensitive = "sk-secret Question: leak me raw-body";

describe("mapProviderDistillationError", () => {
  const cases: Array<{
    name: string;
    error: unknown;
    expected: new (provider: "gemini") => ProviderError;
    code: string;
  }> = [
    {
      name: "401 authentication",
      error: { status: 401, message: sensitive },
      expected: ProviderAuthError,
      code: "provider_auth",
    },
    {
      name: "403 authentication",
      error: { statusCode: 403, message: sensitive },
      expected: ProviderAuthError,
      code: "provider_auth",
    },
    {
      name: "invalid api key message",
      error: new Error(`Invalid API key ${sensitive}`),
      expected: ProviderAuthError,
      code: "provider_auth",
    },
    {
      name: "404 model unavailable",
      error: { status: 404, message: `model not found ${sensitive}` },
      expected: ProviderModelUnavailableError,
      code: "provider_model_unavailable",
    },
    {
      name: "429 rate limit",
      error: { status: 429, message: sensitive },
      expected: ProviderRateLimitError,
      code: "provider_rate_limit",
    },
    {
      name: "quota message",
      error: new Error(`quota exceeded ${sensitive}`),
      expected: ProviderRateLimitError,
      code: "provider_rate_limit",
    },
    {
      name: "safety refusal",
      error: new Error(`blocked by safety ${sensitive}`),
      expected: ProviderRefusalError,
      code: "provider_refusal",
    },
    {
      name: "content filter refusal",
      error: new Error(`content_filter ${sensitive}`),
      expected: ProviderRefusalError,
      code: "provider_refusal",
    },
    {
      name: "500 unavailable",
      error: { status: 503, message: sensitive },
      expected: ProviderUnavailableError,
      code: "provider_unavailable",
    },
    {
      name: "network unavailable",
      error: new Error(`fetch failed ${sensitive}`),
      expected: ProviderUnavailableError,
      code: "provider_unavailable",
    },
    {
      name: "unknown sanitized unavailable",
      error: new Error(sensitive),
      expected: ProviderUnavailableError,
      code: "provider_unavailable",
    },
  ];

  for (const testCase of cases) {
    it(`maps ${testCase.name}`, () => {
      const mapped = mapProviderDistillationError("gemini", testCase.error);
      expect(mapped).toBeInstanceOf(testCase.expected);
      expect(mapped.code).toBe(testCase.code);
      expect(mapped.provider).toBe("gemini");
      expect(mapped.message).not.toContain("sk-secret");
      expect(mapped.message).not.toContain("Question:");
      expect(mapped.message).not.toContain("raw-body");
      expect(mapped.cause).toBeUndefined();
    });
  }
});

describe("parseProviderOutput", () => {
  it("throws sanitized malformed output errors", () => {
    expect(() => parseProviderOutput("openai", "{not-json")).toThrow(
      ProviderMalformedOutputError,
    );
    try {
      parseProviderOutput("openai", `{"summary":"${sensitive}"}`);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ProviderMalformedOutputError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("openai returned an invalid import proposal.");
      expect(message).not.toContain(sensitive);
    }
  });
});
