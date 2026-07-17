import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  ENV_EXAMPLE_CONTENTS,
  assertApiKeyNotPassedOnCli,
  createEnvFromTemplate,
  envPath,
  loadProjectEnv,
  upsertEnvVariable,
  writeApiKeyToEnv,
} from "../src/env.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "parallax-env-"));
}

describe("env template", () => {
  it("matches the tracked .env.example", async () => {
    const example = await readFile(join(process.cwd(), ".env.example"), "utf8");
    expect(example).toBe(ENV_EXAMPLE_CONTENTS);
  });

  it("createEnvFromTemplate writes the template when absent", async () => {
    const root = await tempRoot();
    const result = await createEnvFromTemplate(root);

    expect(result).toEqual({ created: true, path: envPath(root) });
    await expect(readFile(envPath(root), "utf8")).resolves.toBe(ENV_EXAMPLE_CONTENTS);
  });

  it("createEnvFromTemplate never overwrites an existing .env", async () => {
    const root = await tempRoot();
    const path = envPath(root);
    await writeFile(path, "OPENAI_API_KEY=keep-me\n", "utf8");

    const result = await createEnvFromTemplate(root);

    expect(result).toEqual({ created: false, path, reason: "exists" });
    await expect(readFile(path, "utf8")).resolves.toBe("OPENAI_API_KEY=keep-me\n");
  });
});

describe("loadProjectEnv", () => {
  it("loads values from <project-root>/.env", async () => {
    const root = await tempRoot();
    const key = "PARALLAX_ENV_TEST_LOAD";
    delete process.env[key];
    await writeFile(envPath(root), `${key}=from-file\n`, "utf8");

    loadProjectEnv(root);

    expect(process.env[key]).toBe("from-file");
    delete process.env[key];
  });

  it("prefers existing shell environment variables over .env", async () => {
    const root = await tempRoot();
    const key = "PARALLAX_ENV_TEST_PRECEDENCE";
    process.env[key] = "from-shell";
    await writeFile(envPath(root), `${key}=from-file\n`, "utf8");

    loadProjectEnv(root);

    expect(process.env[key]).toBe("from-shell");
    delete process.env[key];
  });
});

describe("writeApiKeyToEnv", () => {
  it("creates .env with owner-only permissions where supported", async () => {
    const root = await tempRoot();
    const secret = "sk-test-never-print";

    const result = await writeApiKeyToEnv({
      projectRoot: root,
      apiKeyEnv: "OPENAI_API_KEY",
      readSecret: async () => secret,
    });

    expect(result).toEqual({
      written: true,
      path: envPath(root),
      created: true,
    });

    const contents = await readFile(envPath(root), "utf8");
    expect(contents).toContain(`OPENAI_API_KEY=${secret}`);
    expect(contents).toContain("# Optional provider and model overrides.");

    if (process.platform !== "win32") {
      const mode = (await stat(envPath(root))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("requires confirmation before modifying an existing .env", async () => {
    const root = await tempRoot();
    const path = envPath(root);
    await writeFile(path, "OPENAI_API_KEY=old\n# keep\n", "utf8");
    if (process.platform !== "win32") {
      await chmod(path, 0o644);
    }

    const declined = await writeApiKeyToEnv({
      projectRoot: root,
      apiKeyEnv: "OPENAI_API_KEY",
      confirm: async () => false,
      readSecret: async () => "should-not-write",
    });
    expect(declined).toEqual({ written: false, path, reason: "declined" });
    await expect(readFile(path, "utf8")).resolves.toBe("OPENAI_API_KEY=old\n# keep\n");

    const updated = await writeApiKeyToEnv({
      projectRoot: root,
      apiKeyEnv: "OPENAI_API_KEY",
      confirm: async () => true,
      readSecret: async () => "sk-new",
    });
    expect(updated).toEqual({ written: true, path, created: false });

    const contents = await readFile(path, "utf8");
    expect(contents).toBe("OPENAI_API_KEY=sk-new\n# keep\n");
    expect(contents).not.toContain("should-not-write");

    if (process.platform !== "win32") {
      const mode = (await stat(path)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("updates only the selected provider variable", async () => {
    const root = await tempRoot();
    const path = envPath(root);
    await writeFile(
      path,
      "OPENAI_API_KEY=keep-openai\nGEMINI_API_KEY=old-gemini\n",
      "utf8",
    );

    await writeApiKeyToEnv({
      projectRoot: root,
      apiKeyEnv: "GEMINI_API_KEY",
      confirm: async () => true,
      readSecret: async () => "new-gemini",
    });

    await expect(readFile(path, "utf8")).resolves.toBe(
      "OPENAI_API_KEY=keep-openai\nGEMINI_API_KEY=new-gemini\n",
    );
  });

  it("fails clearly when no TTY is available", async () => {
    const root = await tempRoot();
    const stdin = new Readable({ read() {} }) as NodeJS.ReadStream;
    const stdout = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }) as NodeJS.WriteStream;
    Object.defineProperty(stdin, "isTTY", { value: false });
    Object.defineProperty(stdout, "isTTY", { value: false });

    await expect(
      writeApiKeyToEnv({
        projectRoot: root,
        apiKeyEnv: "GEMINI_API_KEY",
        stdin,
        stdout,
      }),
    ).rejects.toThrow(
      /TTY is required.*Set the provider API key in the environment or create \.env manually/,
    );
  });

  it("rejects an empty API key without writing", async () => {
    const root = await tempRoot();

    await expect(
      writeApiKeyToEnv({
        projectRoot: root,
        apiKeyEnv: "OPENAI_API_KEY",
        readSecret: async () => "   ",
      }),
    ).rejects.toThrow("API key cannot be empty.");

    await expect(readFile(envPath(root), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("assertApiKeyNotPassedOnCli", () => {
  it("allows boolean --api-key", () => {
    expect(() => assertApiKeyNotPassedOnCli(["--api-key"])).not.toThrow();
    expect(() =>
      assertApiKeyNotPassedOnCli(["--api-key", "--root", "/tmp"]),
    ).not.toThrow();
  });

  it("rejects a key passed as a CLI argument", () => {
    expect(() => assertApiKeyNotPassedOnCli(["--api-key", "sk-leak"])).toThrow(
      /Do not pass the API key on the command line/,
    );
  });

  it("rejects equals-form --api-key= without echoing the secret", () => {
    const secret = "sk-equals-leak";
    expect(() => assertApiKeyNotPassedOnCli([`--api-key=${secret}`])).toThrow(
      /Do not pass the API key on the command line/,
    );
    try {
      assertApiKeyNotPassedOnCli([`--api-key=${secret}`]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secret);
    }
  });
});

describe("upsertEnvVariable", () => {
  it("replaces or appends without exposing the key in structure", () => {
    expect(upsertEnvVariable(ENV_EXAMPLE_CONTENTS, "OPENAI_API_KEY", "sk-a")).toContain(
      "OPENAI_API_KEY=sk-a",
    );
    expect(upsertEnvVariable("# only\n", "GEMINI_API_KEY", "gemini-b")).toBe(
      "# only\nGEMINI_API_KEY=gemini-b\n",
    );
  });

  it("replaces spaced and exported assignments instead of appending", () => {
    expect(
      upsertEnvVariable("OPENAI_API_KEY = old\n# keep\n", "OPENAI_API_KEY", "sk-new"),
    ).toBe("OPENAI_API_KEY=sk-new\n# keep\n");
    expect(
      upsertEnvVariable(
        "export GEMINI_API_KEY = old\n# keep\n",
        "GEMINI_API_KEY",
        "gemini-new",
      ),
    ).toBe("GEMINI_API_KEY=gemini-new\n# keep\n");
  });
});
