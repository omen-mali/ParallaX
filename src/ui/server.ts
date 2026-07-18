import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { CompileTarget, CompiledFile } from "../compiler/compiler.js";
import type { NormalizedChat } from "../contract/types.js";
import type { ChatGptConversationSummary } from "../importer/chatgpt.js";
import type { VerifiedImportDelta } from "../importer/verify.js";
import type { StoreSnapshot } from "../store/read.js";
import { renderUiHtml } from "./page.js";

const MAX_JSON_BODY_BYTES = 25 * 1024 * 1024;
const SESSION_HEADER = "x-parallax-session";
const JSON_CONTENT_TYPE = "application/json";
const SAFE_PROPOSAL_KEY = /^[dtqgs][1-9][0-9]*$/;
const SAFE_PROPOSAL_ID = /^[A-Za-z0-9_-]{16,128}$/;

export const UI_MAX_IMPORT_BYTES = MAX_JSON_BODY_BYTES;

export type UiImportFormat = "generic" | "chatgpt";
export type UiProposalItemKind =
  "decision" | "task" | "question" | "glossary" | "spec-change";

export interface UiProposalItem {
  key: string;
  kind: UiProposalItemKind;
  label: string;
  evidenceQuote: string;
}

/**
 * An in-memory, verified import proposal. The server deliberately keeps the
 * transcript and raw hash in this opaque object instead of serializing them to
 * the browser.
 */
export interface UiPreparedImport {
  chat: NormalizedChat;
  rawHash: string;
  delta: VerifiedImportDelta;
  provider: {
    provider: string;
    model: string;
  };
  items: UiProposalItem[];
}

/** Values safe to expose to the browser. Provider credentials and endpoints
 * are intentionally not part of this type. */
export interface UiConfiguration {
  providers: readonly string[];
  provider: string;
  model: string;
  mock?: boolean;
  mockLocked?: boolean;
}

export interface UiImportRequest {
  format: UiImportFormat;
  contents: string;
  fileName?: string;
  conversationId?: string;
  provider?: string;
  mock?: boolean;
  model?: string;
}

/**
 * Structural boundary between the HTTP/UI layer and ParallaX application
 * orchestration. The CLI can supply the same service implementation.
 */
export interface UiApplicationServices {
  readSnapshot(): Promise<StoreSnapshot>;
  getUiConfig(): Promise<UiConfiguration>;
  inspectChatGpt(input: {
    contents: string;
    fileName?: string;
  }): Promise<ChatGptConversationSummary[]>;
  prepareImport(input: UiImportRequest): Promise<UiPreparedImport>;
  applyPreparedImport(
    prepared: UiPreparedImport,
    options: {
      selectedKeys?: readonly string[];
      metadataOnly?: boolean;
    },
  ): Promise<{ appliedCount: number }>;
  compile(options: { targets?: CompileTarget[] }): Promise<CompiledFile[]>;
}

export type UiBrowserOpener = (url: string) => Promise<void>;
/** Injectable only to make loopback-server tests deterministic. */
export type UiSessionTokenGenerator = () => string;
/** Proposal IDs are opaque handles, not session capabilities. */
export type UiProposalIdGenerator = () => string;

export interface StartUiServerOptions {
  applicationServices: UiApplicationServices;
  openBrowser?: UiBrowserOpener;
  tokenGenerator?: UiSessionTokenGenerator;
  proposalIdGenerator?: UiProposalIdGenerator;
}

export interface UiServerHandle {
  /** The non-capability loopback origin. It never contains the session token. */
  origin: string;
  port: number;
  close(): Promise<void>;
}

interface StoredProposal {
  id: string;
  prepared: UiPreparedImport;
}

type JsonObject = Record<string, unknown>;

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly clientMessage: string,
  ) {
    super(clientMessage);
  }
}

function defaultTokenGenerator(): string {
  return randomBytes(32).toString("base64url");
}

function defaultProposalIdGenerator(): string {
  return randomBytes(24).toString("base64url");
}

/** Open a generated, base64url-only loopback URL with platform tools. */
export async function openSystemBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? { file: "cmd", args: ["/d", "/s", "/c", "start", "", url] }
        : { file: "xdg-open", args: [url] };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      detached: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) {
        resolve();
        return;
      }
      reject(new Error("Unable to open the local ParallaX interface."));
    });
  });
}

function assertGeneratedToken(token: string): void {
  // A 32-byte URL-safe base64 token is always 43 unpadded characters. Re-encode
  // it after decoding so test injection cannot weaken the live session boundary
  // with malformed base64url or a shorter capability.
  const decoded = Buffer.from(token, "base64url");
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    decoded.length !== 32 ||
    decoded.toString("base64url") !== token
  ) {
    throw new Error("Unable to start the local ParallaX interface.");
  }
}

function createNonce(): string {
  return randomBytes(16).toString("base64url");
}

function csp(nonce: string | undefined): string {
  if (nonce === undefined) {
    return "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  }
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function setSecurityHeaders(response: ServerResponse, nonce?: string): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", csp(nonce));
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value);
  setSecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function sendShell(response: ServerResponse): void {
  const nonce = createNonce();
  const body = renderUiHtml({ nonce });
  setSecurityHeaders(response, nonce);
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function sendMethodNotAllowed(response: ServerResponse): void {
  setSecurityHeaders(response);
  response.statusCode = 405;
  response.setHeader("Allow", "GET, POST");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ error: "Method not allowed." }));
}

function isJsonContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) {
    return false;
  }
  return contentType.split(";", 1)[0]?.trim().toLowerCase() === JSON_CONTENT_TYPE;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (!isJsonContentType(request.headers["content-type"])) {
    throw new HttpError(415, "Requests must use application/json.");
  }

  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    if (!/^[0-9]+$/.test(contentLength)) {
      throw new HttpError(400, "Invalid request.");
    }
    if (Number(contentLength) > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "Request body exceeds 25 MiB.");
    }
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "Request body exceeds 25 MiB.");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON request body.");
  }
}

function objectBody(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Invalid request.");
  }
  return value as JsonObject;
}

function assertOnlyFields(value: JsonObject, fields: readonly string[]): void {
  const allowed = new Set(fields);
  if (Object.keys(value).some((field) => !allowed.has(field))) {
    throw new HttpError(400, "Invalid request.");
  }
}

function requiredString(value: JsonObject, field: string): string {
  const result = value[field];
  if (typeof result !== "string") {
    throw new HttpError(400, "Invalid request.");
  }
  return result;
}

function optionalString(value: JsonObject, field: string): string | undefined {
  const result = value[field];
  if (result === undefined) {
    return undefined;
  }
  if (typeof result !== "string") {
    throw new HttpError(400, "Invalid request.");
  }
  return result;
}

function optionalBoolean(value: JsonObject, field: string): boolean | undefined {
  const result = value[field];
  if (result === undefined) {
    return undefined;
  }
  if (typeof result !== "boolean") {
    throw new HttpError(400, "Invalid request.");
  }
  return result;
}

function parseInspectInput(value: unknown): { contents: string; fileName?: string } {
  const body = objectBody(value);
  assertOnlyFields(body, ["contents", "fileName"]);
  return {
    contents: requiredString(body, "contents"),
    ...(optionalString(body, "fileName") === undefined
      ? {}
      : { fileName: optionalString(body, "fileName")! }),
  };
}

function parsePreviewInput(value: unknown): UiImportRequest {
  const body = objectBody(value);
  assertOnlyFields(body, [
    "format",
    "contents",
    "fileName",
    "conversationId",
    "provider",
    "mock",
    "model",
  ]);
  const format = requiredString(body, "format");
  if (format !== "generic" && format !== "chatgpt") {
    throw new HttpError(400, "Invalid request.");
  }
  const fileName = optionalString(body, "fileName");
  const conversationId = optionalString(body, "conversationId");
  const provider = optionalString(body, "provider");
  const mock = optionalBoolean(body, "mock");
  const model = optionalString(body, "model");
  return {
    format,
    contents: requiredString(body, "contents"),
    ...(fileName === undefined ? {} : { fileName }),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(provider === undefined ? {} : { provider }),
    ...(mock === undefined ? {} : { mock }),
    ...(model === undefined ? {} : { model }),
  };
}

function parseApplyInput(value: unknown): {
  selectedKeys: string[];
  metadataOnly: boolean;
  confirmed: true;
} {
  const body = objectBody(value);
  assertOnlyFields(body, ["selectedKeys", "metadataOnly", "confirmed"]);
  if (!Array.isArray(body.selectedKeys) || !body.selectedKeys.every(isString)) {
    throw new HttpError(400, "Invalid request.");
  }
  if (typeof body.metadataOnly !== "boolean" || body.confirmed !== true) {
    throw new HttpError(400, "Confirmation is required before applying a proposal.");
  }
  return {
    selectedKeys: body.selectedKeys,
    metadataOnly: body.metadataOnly,
    confirmed: true,
  };
}

function parseCompileInput(value: unknown): { targets: CompileTarget[] } {
  const body = objectBody(value);
  assertOnlyFields(body, ["targets"]);
  if (!Array.isArray(body.targets) || !body.targets.every(isCompileTarget)) {
    throw new HttpError(400, "Invalid request.");
  }
  if (body.targets.length === 0 || new Set(body.targets).size !== body.targets.length) {
    throw new HttpError(400, "Select at least one compile target.");
  }
  return { targets: body.targets };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isCompileTarget(value: unknown): value is CompileTarget {
  return value === "agents" || value === "claude" || value === "cursor";
}

function isAuthorized(request: IncomingMessage, sessionToken: string): boolean {
  const supplied = request.headers[SESSION_HEADER];
  if (typeof supplied !== "string") {
    return false;
  }
  const expectedBuffer = Buffer.from(sessionToken, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

function assertSameOrigin(request: IncomingMessage, origin: string): void {
  if (request.headers.origin !== origin) {
    throw new HttpError(403, "Requests must originate from the local interface.");
  }
}

function publicConfiguration(config: UiConfiguration): UiConfiguration {
  return {
    providers: config.providers.filter(isString),
    provider: config.provider,
    model: config.model,
    ...(config.mock === undefined ? {} : { mock: config.mock }),
    ...(config.mockLocked === undefined ? {} : { mockLocked: config.mockLocked }),
  };
}

function publicProposal(proposal: StoredProposal): {
  id: string;
  summary: string;
  provider: { provider: string; model: string };
  items: UiProposalItem[];
} {
  return {
    id: proposal.id,
    summary: proposal.prepared.delta.summary,
    provider: {
      provider: proposal.prepared.provider.provider,
      model: proposal.prepared.provider.model,
    },
    items: proposal.prepared.items.map((item) => ({
      key: item.key,
      kind: item.kind,
      label: item.label,
      evidenceQuote: item.evidenceQuote,
    })),
  };
}

function validateSelection(
  selectedKeys: readonly string[],
  proposal: StoredProposal,
): void {
  if (selectedKeys.length === 0) {
    throw new HttpError(400, "Select at least one proposal item.");
  }
  const available = new Set(proposal.prepared.items.map((item) => item.key));
  const selected = new Set<string>();
  for (const key of selectedKeys) {
    if (!SAFE_PROPOSAL_KEY.test(key) || !available.has(key) || selected.has(key)) {
      throw new HttpError(400, "Invalid proposal selection.");
    }
    selected.add(key);
  }
}

function proposalIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/api\/proposals\/([^/]+)\/apply$/);
  if (match?.[1] === undefined) {
    return undefined;
  }
  try {
    const id = decodeURIComponent(match[1]);
    return SAFE_PROPOSAL_ID.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function listenLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (
        address === null ||
        typeof address === "string" ||
        address.address !== "127.0.0.1"
      ) {
        void closeServer(server);
        reject(new Error("Unable to start the local ParallaX interface."));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true });
  });
}

/**
 * Starts an IPv4-loopback-only UI server and opens it in the system browser.
 * The launch token stays in a URL fragment, so it never reaches this server.
 */
export async function startUiServer(
  options: StartUiServerOptions,
): Promise<UiServerHandle> {
  const sessionToken = (options.tokenGenerator ?? defaultTokenGenerator)();
  assertGeneratedToken(sessionToken);
  const proposalIdGenerator = options.proposalIdGenerator ?? defaultProposalIdGenerator;
  const openBrowser = options.openBrowser ?? openSystemBrowser;
  const { applicationServices } = options;
  let origin = "";
  let currentProposal: StoredProposal | undefined;
  let previewGeneration = 0;
  let applyInProgress = false;
  let compileInProgress = false;

  const server = createServer((request, response) => {
    void (async () => {
      try {
        const method = request.method ?? "";
        const url = new URL(request.url ?? "/", origin || "http://127.0.0.1");

        if (method === "GET" && url.pathname === "/") {
          sendShell(response);
          return;
        }

        if (!url.pathname.startsWith("/api/")) {
          if (method !== "GET" && method !== "POST") {
            sendMethodNotAllowed(response);
          } else {
            sendJson(response, 404, { error: "Not found." });
          }
          return;
        }

        if (!isAuthorized(request, sessionToken)) {
          sendJson(response, 401, { error: "Unauthorized." });
          return;
        }

        if (method === "GET" && url.pathname === "/api/snapshot") {
          if (applyInProgress) {
            throw new HttpError(
              409,
              "An import is being applied. Wait for it to finish before refreshing the snapshot.",
            );
          }
          sendJson(response, 200, {
            snapshot: await applicationServices.readSnapshot(),
          });
          return;
        }

        if (method === "GET" && url.pathname === "/api/config") {
          sendJson(
            response,
            200,
            publicConfiguration(await applicationServices.getUiConfig()),
          );
          return;
        }

        if (method !== "POST") {
          sendMethodNotAllowed(response);
          return;
        }

        assertSameOrigin(request, origin);
        const isPreviewRequest = url.pathname === "/api/imports/preview";
        let requestPreviewGeneration: number | undefined;
        if (isPreviewRequest) {
          if (applyInProgress) {
            throw new HttpError(
              409,
              "An apply is in progress. Wait for it to finish before creating a new preview.",
            );
          }
          // Invalidate before reading the request body so a slow upload cannot
          // leave an older proposal available for application.
          requestPreviewGeneration = ++previewGeneration;
          currentProposal = undefined;
        }
        const body = await readJsonBody(request);

        if (url.pathname === "/api/imports/inspect") {
          const conversations = await applicationServices.inspectChatGpt(
            parseInspectInput(body),
          );
          sendJson(response, 200, { conversations });
          return;
        }

        if (isPreviewRequest) {
          // A new preview invalidates any previous one even when preparation
          // fails, preventing application of a proposal after changed input.
          const generation = requestPreviewGeneration;
          const prepared = await applicationServices.prepareImport(
            parsePreviewInput(body),
          );
          if (
            generation === undefined ||
            applyInProgress ||
            generation !== previewGeneration
          ) {
            throw new HttpError(
              409,
              "A newer preview replaced this proposal. Review the latest proposal instead.",
            );
          }
          const id = proposalIdGenerator();
          if (!SAFE_PROPOSAL_ID.test(id)) {
            throw new Error("Unable to prepare the import proposal.");
          }
          currentProposal = { id, prepared };
          sendJson(response, 200, {
            proposal: publicProposal(currentProposal),
          });
          return;
        }

        const proposalId = proposalIdFromPath(url.pathname);
        if (proposalId !== undefined) {
          if (currentProposal === undefined || currentProposal.id !== proposalId) {
            throw new HttpError(
              409,
              "Proposal is no longer available. Create a new preview.",
            );
          }
          const input = parseApplyInput(body);
          validateSelection(input.selectedKeys, currentProposal);
          if (compileInProgress) {
            throw new HttpError(
              409,
              "Context compilation is in progress. Wait for it to finish before applying an import.",
            );
          }

          // Consume before the asynchronous writer starts so concurrent or
          // repeated requests cannot apply the same source twice.
          const proposal = currentProposal;
          currentProposal = undefined;
          previewGeneration += 1;
          applyInProgress = true;
          try {
            const applied = await applicationServices.applyPreparedImport(
              proposal.prepared,
              {
                selectedKeys: input.selectedKeys,
                metadataOnly: input.metadataOnly,
              },
            );
            sendJson(response, 200, {
              appliedCount: applied.appliedCount,
              snapshot: await applicationServices.readSnapshot(),
            });
          } finally {
            applyInProgress = false;
          }
          return;
        }

        if (url.pathname === "/api/compile") {
          if (applyInProgress) {
            throw new HttpError(
              409,
              "An import is being applied. Wait for it to finish before compiling context.",
            );
          }
          if (compileInProgress) {
            throw new HttpError(
              409,
              "Context compilation is already in progress. Wait for it to finish before compiling again.",
            );
          }
          compileInProgress = true;
          try {
            const compiled = await applicationServices.compile(parseCompileInput(body));
            // Do not expose arbitrary filesystem results. The service receives
            // only validated targets and this response returns only those names.
            sendJson(response, 200, {
              compiled: compiled.map(({ target }) => ({ target })),
              snapshot: await applicationServices.readSnapshot(),
            });
          } finally {
            compileInProgress = false;
          }
          return;
        }

        sendJson(response, 404, { error: "Not found." });
      } catch (error: unknown) {
        if (response.writableEnded || response.destroyed) {
          return;
        }
        if (error instanceof HttpError) {
          sendJson(response, error.statusCode, { error: error.clientMessage });
          return;
        }
        // Provider, parser, and filesystem errors can contain user-imported
        // content or secrets. Keep them server-side and expose no details.
        sendJson(response, 500, { error: "Unable to complete request." });
      }
    })();
  });

  let port: number;
  try {
    port = await listenLoopback(server);
    origin = `http://127.0.0.1:${port}`;
    const capabilityUrl = `${origin}/#session=${encodeURIComponent(sessionToken)}`;
    try {
      await openBrowser(capabilityUrl);
    } catch {
      await closeServer(server);
      throw new Error("Unable to open the local ParallaX interface.");
    }
  } catch (error) {
    if (server.listening) {
      await closeServer(server).catch(() => undefined);
    }
    throw error;
  }

  return {
    origin,
    port,
    close: () => closeServer(server),
  };
}
