import type { LiveProviderId } from "./distiller.js";

export type ProviderErrorCode =
  | "provider_auth"
  | "provider_model_unavailable"
  | "provider_rate_limit"
  | "provider_refusal"
  | "provider_malformed_output"
  | "provider_unavailable";

export class ProviderError extends Error {
  readonly provider: LiveProviderId;
  readonly code: ProviderErrorCode;

  constructor(provider: LiveProviderId, code: ProviderErrorCode, message: string) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.code = code;
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(provider: LiveProviderId) {
    super(provider, "provider_auth", `Authentication failed for ${provider}.`);
    this.name = "ProviderAuthError";
  }
}

export class ProviderModelUnavailableError extends ProviderError {
  constructor(provider: LiveProviderId) {
    super(provider, "provider_model_unavailable", `Model unavailable for ${provider}.`);
    this.name = "ProviderModelUnavailableError";
  }
}

export class ProviderRateLimitError extends ProviderError {
  constructor(provider: LiveProviderId) {
    super(provider, "provider_rate_limit", `Rate limit exceeded for ${provider}.`);
    this.name = "ProviderRateLimitError";
  }
}

export class ProviderRefusalError extends ProviderError {
  constructor(provider: LiveProviderId) {
    super(provider, "provider_refusal", `${provider} refused the request.`);
    this.name = "ProviderRefusalError";
  }
}

export class ProviderMalformedOutputError extends ProviderError {
  constructor(provider: LiveProviderId) {
    super(
      provider,
      "provider_malformed_output",
      `${provider} returned an invalid import proposal.`,
    );
    this.name = "ProviderMalformedOutputError";
  }
}

export class ProviderUnavailableError extends ProviderError {
  constructor(provider: LiveProviderId) {
    super(
      provider,
      "provider_unavailable",
      `${provider} distillation failed. Check provider credentials, model access, and service availability.`,
    );
    this.name = "ProviderUnavailableError";
  }
}

function readStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") {
    return undefined;
  }
  const candidate = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "code"] as const) {
    const value = candidate[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && /^\d{3}$/.test(value)) {
      return Number(value);
    }
  }
  return undefined;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  if (typeof error === "string") {
    return error.toLowerCase();
  }
  return "";
}

/**
 * Map conservative SDK signals to sanitized provider error classes.
 * Never attaches the original error, raw body, key, or transcript text.
 */
export function mapProviderDistillationError(
  provider: LiveProviderId,
  error: unknown,
): ProviderError {
  const status = readStatus(error);
  const message = readMessage(error);

  if (
    status === 401 ||
    status === 403 ||
    message.includes("unauthorized") ||
    message.includes("invalid api key") ||
    message.includes("authentication") ||
    message.includes("permission denied")
  ) {
    return new ProviderAuthError(provider);
  }

  if (
    status === 404 ||
    message.includes("model not found") ||
    message.includes("not found: model") ||
    message.includes("unknown model") ||
    message.includes("does not exist")
  ) {
    return new ProviderModelUnavailableError(provider);
  }

  if (
    status === 429 ||
    message.includes("rate limit") ||
    message.includes("resource_exhausted") ||
    message.includes("quota")
  ) {
    return new ProviderRateLimitError(provider);
  }

  if (
    message.includes("safety") ||
    message.includes("blocked") ||
    message.includes("refusal") ||
    message.includes("refused") ||
    message.includes("content_filter")
  ) {
    return new ProviderRefusalError(provider);
  }

  if (status !== undefined && status >= 500 && status <= 599) {
    return new ProviderUnavailableError(provider);
  }

  if (
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("etimedout") ||
    message.includes("network")
  ) {
    return new ProviderUnavailableError(provider);
  }

  return new ProviderUnavailableError(provider);
}
