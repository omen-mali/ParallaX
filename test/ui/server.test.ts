import { request as createHttpRequest } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompileTarget } from "../../src/compiler/compiler.js";
import type { StoreSnapshot } from "../../src/store/read.js";
import {
  UI_MAX_IMPORT_BYTES,
  startUiServer,
  type StartUiServerOptions,
  type UiApplicationServices,
  type UiPreparedImport,
  type UiServerHandle,
} from "../../src/ui/server.js";

const sessionToken = "A".repeat(43);

const emptySnapshot: StoreSnapshot = {
  decisions: [],
  tasks: [],
  questions: [],
  glossary: [],
  specChanges: [],
  sources: [],
  omittedRecordCount: 0,
};

function preparedImport(): UiPreparedImport {
  return {
    chat: {
      schemaVersion: 1,
      id: `src_${"a".repeat(64)}`,
      source: "generic",
      title: "Test import",
      turns: [{ index: 0, role: "user", text: "Decision evidence" }],
    },
    rawHash: "b".repeat(64),
    delta: {
      summary: "A verified proposal.",
      decisions: [],
      tasks: [],
      questions: [],
      glossary: [],
      specChanges: [],
    },
    provider: { provider: "mock", model: "mock" },
    items: [
      {
        key: "d1",
        kind: "decision",
        label: "Keep the proposal in memory",
        evidenceQuote: "Decision evidence",
      },
      {
        key: "t1",
        kind: "task",
        label: "Test the local server",
        evidenceQuote: "Decision evidence",
      },
    ],
  };
}

function fakeServices(): {
  services: UiApplicationServices;
  calls: {
    readSnapshot: ReturnType<typeof vi.fn>;
    inspectChatGpt: ReturnType<typeof vi.fn>;
    prepareImport: ReturnType<typeof vi.fn>;
    applyPreparedImport: ReturnType<typeof vi.fn>;
    compile: ReturnType<typeof vi.fn>;
  };
} {
  const calls = {
    readSnapshot: vi.fn(async () => emptySnapshot),
    inspectChatGpt: vi.fn(async () => [{ id: "chat-1", title: "One chat" }]),
    prepareImport: vi.fn(async () => preparedImport()),
    applyPreparedImport: vi.fn(async () => ({ appliedCount: 1 })),
    compile: vi.fn(async () => [{ target: "agents" as const, path: "/tmp/AGENTS.md" }]),
  };
  return {
    services: {
      readSnapshot: calls.readSnapshot,
      getUiConfig: async () => ({
        providers: ["mock"],
        provider: "mock",
        model: "mock",
      }),
      inspectChatGpt: calls.inspectChatGpt,
      prepareImport: calls.prepareImport,
      applyPreparedImport: calls.applyPreparedImport,
      compile: calls.compile,
    },
    calls,
  };
}

async function launch(overrides: Partial<StartUiServerOptions> = {}): Promise<{
  handle: UiServerHandle;
  openedUrls: string[];
  services: ReturnType<typeof fakeServices>;
}> {
  const services = fakeServices();
  const openedUrls: string[] = [];
  const handle = await startUiServer({
    applicationServices: services.services,
    tokenGenerator: () => sessionToken,
    openBrowser: async (url) => {
      openedUrls.push(url);
    },
    ...overrides,
  });
  return { handle, openedUrls, services };
}

async function jsonRequest(
  handle: UiServerHandle,
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  headers.set("X-Parallax-Session", sessionToken);
  if (method === "POST") {
    headers.set("Origin", handle.origin);
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${handle.origin}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve: (value) => resolve?.(value),
  };
}

const handles: UiServerHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  vi.restoreAllMocks();
});

describe("loopback local UI server", () => {
  it("binds an IPv4 loopback origin, keeps its token in the launch fragment, and serves a hardened shell", async () => {
    const { handle, openedUrls } = await launch();
    handles.push(handle);

    expect(handle.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(openedUrls).toHaveLength(1);
    const launched = new URL(openedUrls[0]!);
    expect(`${launched.protocol}//${launched.host}`).toBe(handle.origin);
    expect(launched.pathname).toBe("/");
    expect(launched.search).toBe("");
    expect(launched.hash).toBe(`#session=${sessionToken}`);

    const response = await fetch(`${handle.origin}/`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(html).not.toContain(sessionToken);
    expect(html).toContain("textContent");
  });

  it("creates a fresh 32-byte base64url session token when no test generator is supplied", async () => {
    const { services } = fakeServices();
    const openedUrls: string[] = [];
    const handle = await startUiServer({
      applicationServices: services,
      openBrowser: async (url) => {
        openedUrls.push(url);
      },
    });
    handles.push(handle);

    const token = new URL(openedUrls[0]!).hash.replace(/^#session=/, "");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(Buffer.from(token, "base64url").toString("base64url")).toBe(token);
  });

  it("rejects test-injected session values that are not canonical 32-byte base64url tokens", async () => {
    const { services } = fakeServices();
    const openBrowser = vi.fn(async () => undefined);

    await expect(
      startUiServer({
        applicationServices: services,
        tokenGenerator: () => "short",
        openBrowser,
      }),
    ).rejects.toThrow("Unable to start the local ParallaX interface.");
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("requires its session token for every API and an exact local Origin for mutations", async () => {
    const { handle, services } = await launch();
    handles.push(handle);

    const noToken = await fetch(`${handle.origin}/api/snapshot`);
    expect(noToken.status).toBe(401);

    const wrongOrigin = await fetch(`${handle.origin}/api/imports/inspect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Parallax-Session": sessionToken,
        Origin: "http://localhost:1",
      },
      body: JSON.stringify({ contents: "[]" }),
    });
    expect(wrongOrigin.status).toBe(403);
    expect(services.calls.inspectChatGpt).not.toHaveBeenCalled();

    const nonJson = await fetch(`${handle.origin}/api/imports/inspect`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Parallax-Session": sessionToken,
        Origin: handle.origin,
      },
      body: "[]",
    });
    expect(nonJson.status).toBe(415);
    expect(nonJson.headers.get("access-control-allow-origin")).toBeNull();

    const malformed = await fetch(`${handle.origin}/api/imports/inspect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Parallax-Session": sessionToken,
        Origin: handle.origin,
      },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(services.calls.inspectChatGpt).not.toHaveBeenCalled();

    const snapshot = await jsonRequest(handle, "/api/snapshot");
    expect(snapshot.status).toBe(200);
    await expect(snapshot.json()).resolves.toEqual({ snapshot: emptySnapshot });
  });

  it("bounds JSON request bodies and exposes only browser-safe provider configuration", async () => {
    const { handle, services } = await launch();
    handles.push(handle);
    services.services.getUiConfig = async () =>
      ({
        providers: ["mock", "openai"],
        provider: "mock",
        model: "mock",
        mock: true,
        mockLocked: true,
        apiKey: "must-not-reach-browser",
        apiKeyEnv: "SECRET_KEY_NAME",
        baseUrl: "https://private.example.test/v1",
      }) as never;

    const config = await jsonRequest(handle, "/api/config");
    expect(config.status).toBe(200);
    await expect(config.json()).resolves.toEqual({
      providers: ["mock", "openai"],
      provider: "mock",
      model: "mock",
      mock: true,
      mockLocked: true,
    });

    const oversized = await jsonRequest(handle, "/api/imports/preview", {
      method: "POST",
      body: {
        format: "generic",
        contents: "x".repeat(UI_MAX_IMPORT_BYTES),
      },
    });
    expect(oversized.status).toBe(413);
    expect(services.calls.prepareImport).not.toHaveBeenCalled();
  });

  it("inspects and previews only the explicitly selected ChatGPT conversation", async () => {
    const { handle, services } = await launch();
    handles.push(handle);

    const inspected = await jsonRequest(handle, "/api/imports/inspect", {
      method: "POST",
      body: { contents: "[chatgpt export]", fileName: "conversations.json" },
    });
    expect(inspected.status).toBe(200);
    await expect(inspected.json()).resolves.toEqual({
      conversations: [{ id: "chat-1", title: "One chat" }],
    });

    const previewed = await jsonRequest(handle, "/api/imports/preview", {
      method: "POST",
      body: {
        format: "chatgpt",
        contents: "[chatgpt export]",
        fileName: "conversations.json",
        conversationId: "chat-1",
        provider: "mock",
        model: "mock",
      },
    });
    expect(previewed.status).toBe(200);
    expect(services.calls.prepareImport).toHaveBeenCalledWith({
      format: "chatgpt",
      contents: "[chatgpt export]",
      fileName: "conversations.json",
      conversationId: "chat-1",
      provider: "mock",
      model: "mock",
    });
  });

  it("keeps one opaque proposal, rejects invalid selections, and consumes it exactly once after confirmation", async () => {
    const { handle, services } = await launch({
      proposalIdGenerator: (() => {
        let count = 0;
        return () => `proposal-${String(++count).padStart(10, "0")}`;
      })(),
    });
    handles.push(handle);

    const firstPreview = await jsonRequest(handle, "/api/imports/preview", {
      method: "POST",
      body: { format: "generic", contents: "## User\n\nDecision evidence" },
    });
    const firstPayload = (await firstPreview.json()) as {
      proposal: { id: string; items: Array<{ key: string; kind: string }> };
    };
    expect(firstPreview.status).toBe(200);
    expect(firstPayload.proposal.items).toEqual([
      expect.objectContaining({ key: "d1", kind: "decision" }),
      expect.objectContaining({ key: "t1", kind: "task" }),
    ]);

    const secondPreview = await jsonRequest(handle, "/api/imports/preview", {
      method: "POST",
      body: { format: "generic", contents: "## User\n\nA replacement" },
    });
    const secondPayload = (await secondPreview.json()) as {
      proposal: { id: string };
    };
    expect(secondPayload.proposal.id).not.toBe(firstPayload.proposal.id);

    const stale = await jsonRequest(
      handle,
      `/api/proposals/${firstPayload.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: ["d1"], metadataOnly: false, confirmed: true },
      },
    );
    expect(stale.status).toBe(409);

    const empty = await jsonRequest(
      handle,
      `/api/proposals/${secondPayload.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: [], metadataOnly: false, confirmed: true },
      },
    );
    expect(empty.status).toBe(400);

    const unknown = await jsonRequest(
      handle,
      `/api/proposals/${secondPayload.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: ["q9"], metadataOnly: false, confirmed: true },
      },
    );
    expect(unknown.status).toBe(400);
    expect(services.calls.applyPreparedImport).not.toHaveBeenCalled();

    const unconfirmed = await jsonRequest(
      handle,
      `/api/proposals/${secondPayload.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: ["d1"], metadataOnly: true, confirmed: false },
      },
    );
    expect(unconfirmed.status).toBe(400);

    const missingConfirmation = await jsonRequest(
      handle,
      `/api/proposals/${secondPayload.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: ["d1"], metadataOnly: true },
      },
    );
    expect(missingConfirmation.status).toBe(400);
    expect(services.calls.applyPreparedImport).not.toHaveBeenCalled();

    const unexpectedField = await jsonRequest(
      handle,
      `/api/proposals/${secondPayload.proposal.id}/apply`,
      {
        method: "POST",
        body: {
          selectedKeys: ["d1"],
          metadataOnly: true,
          confirmed: true,
          extra: true,
        },
      },
    );
    expect(unexpectedField.status).toBe(400);

    const applied = await jsonRequest(
      handle,
      `/api/proposals/${secondPayload.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: ["d1"], metadataOnly: true, confirmed: true },
      },
    );
    expect(applied.status).toBe(200);
    expect(services.calls.applyPreparedImport).toHaveBeenCalledWith(
      expect.objectContaining({ rawHash: "b".repeat(64) }),
      { selectedKeys: ["d1"], metadataOnly: true },
    );

    const replay = await jsonRequest(
      handle,
      `/api/proposals/${secondPayload.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: ["d1"], metadataOnly: true, confirmed: true },
      },
    );
    expect(replay.status).toBe(409);
    expect(services.calls.applyPreparedImport).toHaveBeenCalledTimes(1);
  });

  it("keeps the latest overlapping preview and rejects the superseded response", async () => {
    const { services } = fakeServices();
    let invocation = 0;
    let markFirstStarted: (() => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const prepareImport = vi.fn(async () => {
      invocation += 1;
      if (invocation === 1) {
        markFirstStarted?.();
        await firstReleased;
      }
      return preparedImport();
    });
    services.prepareImport = prepareImport;

    const { handle } = await launch({ applicationServices: services });
    handles.push(handle);

    const first = jsonRequest(handle, "/api/imports/preview", {
      method: "POST",
      body: { format: "generic", contents: "first" },
    });
    await firstStarted;
    const second = await jsonRequest(handle, "/api/imports/preview", {
      method: "POST",
      body: { format: "generic", contents: "second" },
    });
    releaseFirst?.();
    const firstResponse = await first;

    expect(second.status).toBe(200);
    expect(firstResponse.status).toBe(409);
    expect(prepareImport).toHaveBeenCalledTimes(2);
  });

  it("invalidates an earlier proposal before a slow preview upload completes", async () => {
    const { handle, services } = await launch();
    handles.push(handle);

    const preview = await jsonRequest(handle, "/api/imports/preview", {
      method: "POST",
      body: { format: "generic", contents: "first proposal" },
    });
    const payload = (await preview.json()) as { proposal: { id: string } };

    const slowPreview = createHttpRequest(`${handle.origin}/api/imports/preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: handle.origin,
        "X-Parallax-Session": sessionToken,
      },
    });
    const slowResult = new Promise<number>((resolve, reject) => {
      slowPreview.once("response", (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      });
      slowPreview.once("error", reject);
    });
    slowPreview.write("{");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const stale = await jsonRequest(
      handle,
      `/api/proposals/${payload.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: ["d1"], metadataOnly: false, confirmed: true },
      },
    );
    expect(stale.status).toBe(409);
    expect(services.calls.applyPreparedImport).not.toHaveBeenCalled();

    slowPreview.end("}");
    expect(await slowResult).toBe(400);
  });

  it("does not compile during an apply or apply during a compilation", async () => {
    const { handle, services } = await launch();
    handles.push(handle);

    const firstPreview = await jsonRequest(handle, "/api/imports/preview", {
      method: "POST",
      body: { format: "generic", contents: "first proposal" },
    });
    const firstProposal = (await firstPreview.json()) as { proposal: { id: string } };
    const applyStarted = deferred<void>();
    const releaseApply = deferred<void>();
    const applyPreparedImport = vi.fn(async () => {
      applyStarted.resolve(undefined);
      await releaseApply.promise;
      return { appliedCount: 1 };
    });
    services.services.applyPreparedImport = applyPreparedImport;

    const applying = jsonRequest(
      handle,
      `/api/proposals/${firstProposal.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: ["d1"], metadataOnly: false, confirmed: true },
      },
    );
    await applyStarted.promise;
    const blockedCompile = await jsonRequest(handle, "/api/compile", {
      method: "POST",
      body: { targets: ["agents"] },
    });
    expect(blockedCompile.status).toBe(409);
    expect(services.calls.compile).not.toHaveBeenCalled();
    releaseApply.resolve(undefined);
    expect((await applying).status).toBe(200);

    const secondPreview = await jsonRequest(handle, "/api/imports/preview", {
      method: "POST",
      body: { format: "generic", contents: "second proposal" },
    });
    const secondProposal = (await secondPreview.json()) as { proposal: { id: string } };
    const compileStarted = deferred<void>();
    const releaseCompile = deferred<void>();
    const compile = vi.fn(async () => {
      compileStarted.resolve(undefined);
      await releaseCompile.promise;
      return [{ target: "agents" as const, path: "/tmp/AGENTS.md" }];
    });
    services.services.compile = compile;

    const compiling = jsonRequest(handle, "/api/compile", {
      method: "POST",
      body: { targets: ["agents"] },
    });
    await compileStarted.promise;
    const blockedApply = await jsonRequest(
      handle,
      `/api/proposals/${secondProposal.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: ["d1"], metadataOnly: false, confirmed: true },
      },
    );
    expect(blockedApply.status).toBe(409);
    expect(applyPreparedImport).toHaveBeenCalledTimes(1);
    releaseCompile.resolve(undefined);
    expect((await compiling).status).toBe(200);

    const appliedAfterCompile = await jsonRequest(
      handle,
      `/api/proposals/${secondProposal.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: ["d1"], metadataOnly: false, confirmed: true },
      },
    );
    expect(appliedAfterCompile.status).toBe(200);
    expect(applyPreparedImport).toHaveBeenCalledTimes(2);
  });

  it("does not expose a transient store while an approved proposal is applying", async () => {
    const { handle, services } = await launch();
    handles.push(handle);

    const preview = await jsonRequest(handle, "/api/imports/preview", {
      method: "POST",
      body: { format: "generic", contents: "Decision evidence" },
    });
    const previewPayload = (await preview.json()) as { proposal: { id: string } };

    const started = deferred<void>();
    const completed = deferred<{ appliedCount: number }>();
    services.calls.applyPreparedImport.mockImplementationOnce(async () => {
      started.resolve(undefined);
      return completed.promise;
    });

    const applying = jsonRequest(
      handle,
      `/api/proposals/${previewPayload.proposal.id}/apply`,
      {
        method: "POST",
        body: { selectedKeys: ["d1"], metadataOnly: false, confirmed: true },
      },
    );
    await started.promise;

    const [snapshot, newPreview, compile] = await Promise.all([
      jsonRequest(handle, "/api/snapshot"),
      jsonRequest(handle, "/api/imports/preview", {
        method: "POST",
        body: { format: "generic", contents: "Replacement evidence" },
      }),
      jsonRequest(handle, "/api/compile", {
        method: "POST",
        body: { targets: ["agents"] },
      }),
    ]);
    expect(snapshot.status).toBe(409);
    expect(newPreview.status).toBe(409);
    expect(compile.status).toBe(409);

    completed.resolve({ appliedCount: 1 });
    expect((await applying).status).toBe(200);
  });

  it("fails closed when the browser cannot be opened", async () => {
    const { services } = fakeServices();
    let launchOrigin = "";
    await expect(
      startUiServer({
        applicationServices: services,
        tokenGenerator: () => sessionToken,
        openBrowser: async (url) => {
          launchOrigin = new URL(url).origin;
          throw new Error("browser failure");
        },
      }),
    ).rejects.toThrow("Unable to open the local ParallaX interface.");
    await expect(fetch(`${launchOrigin}/`)).rejects.toThrow();
  });

  it("accepts only the fixed compile target allowlist", async () => {
    const { handle, services } = await launch();
    handles.push(handle);

    const rejected = await jsonRequest(handle, "/api/compile", {
      method: "POST",
      body: { targets: ["agents", "anything-else"] },
    });
    expect(rejected.status).toBe(400);
    expect(services.calls.compile).not.toHaveBeenCalled();

    const compiled = await jsonRequest(handle, "/api/compile", {
      method: "POST",
      body: { targets: ["agents", "cursor"] satisfies CompileTarget[] },
    });
    expect(compiled.status).toBe(200);
    expect(services.calls.compile).toHaveBeenCalledWith({
      targets: ["agents", "cursor"],
    });
    await expect(compiled.json()).resolves.toMatchObject({
      compiled: [{ target: "agents" }],
      snapshot: emptySnapshot,
    });
  });
});
