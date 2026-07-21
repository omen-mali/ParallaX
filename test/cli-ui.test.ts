import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { runCli, type CliDependencies, type CliIO } from "../src/cli.js";

function io(): { value: CliIO; output: () => string } {
  let output = "";
  const stdin = new Readable({ read() {} }) as NodeJS.ReadStream;
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString("utf8");
      callback();
    },
  }) as NodeJS.WriteStream;
  return { value: { stdin, stdout }, output: () => output };
}

describe("parallax ui CLI", () => {
  it("treats a bare script argument separator as no command", async () => {
    const output = io();

    await expect(runCli(["--"], output.value)).resolves.toBeUndefined();

    expect(output.output()).toContain("Usage:");
    expect(output.output()).not.toContain("Unknown command");
  });

  it("tolerates a leading script argument separator", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-ui-cli-"));
    const output = io();
    const startUiServer = vi.fn(
      async (
        _options: Parameters<NonNullable<CliDependencies["startUiServer"]>>[0],
      ) => ({
        origin: "http://127.0.0.1:12345",
        port: 12345,
        close: async () => undefined,
      }),
    );

    await runCli(["--", "ui", "--root", root, "--mock"], output.value, {
      startUiServer,
    });

    expect(startUiServer).toHaveBeenCalledTimes(1);
    expect(output.output()).toContain("Opened ParallaX local UI");
  });

  it("starts the injected loopback surface with the selected root and store", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-ui-cli-"));
    const output = io();
    const startUiServer = vi.fn(
      async (
        _options: Parameters<NonNullable<CliDependencies["startUiServer"]>>[0],
      ) => ({
        origin: "http://127.0.0.1:12345",
        port: 12345,
        close: async () => undefined,
      }),
    );

    await runCli(
      ["ui", "--root", root, "--store", ".parallax.local", "--mock"],
      output.value,
      { startUiServer },
    );

    expect(startUiServer).toHaveBeenCalledTimes(1);
    const options = startUiServer.mock.calls[0]?.[0];
    expect(options).toBeDefined();
    const applicationServices = options.applicationServices as unknown as {
      projectRoot: string;
      storeRoot: string;
    };
    expect(applicationServices.projectRoot).toBe(root);
    expect(applicationServices.storeRoot).toBe(join(root, ".parallax.local"));
    expect(output.output()).toContain("Opened ParallaX local UI");
  });

  it("rejects conflicting mock and provider launch options before starting the server", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallax-ui-cli-"));
    const startUiServer = vi.fn(
      async (
        _options: Parameters<NonNullable<CliDependencies["startUiServer"]>>[0],
      ) => ({
        origin: "http://127.0.0.1:12345",
        port: 12345,
        close: async () => undefined,
      }),
    );

    await expect(
      runCli(["ui", "--root", root, "--mock", "--provider", "openai"], io().value, {
        startUiServer,
      }),
    ).rejects.toThrow("--mock conflicts with a live --provider.");
    expect(startUiServer).not.toHaveBeenCalled();
  });
});
