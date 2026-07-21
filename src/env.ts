import { config as loadDotenv } from "dotenv";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";

export const ENV_FILE_NAME = ".env";

/** Canonical template contents; keep in sync with the tracked `.env.example`. */
export const ENV_EXAMPLE_CONTENTS = `# Required only for the selected live provider. Never commit real keys.
OPENAI_API_KEY=
GEMINI_API_KEY=
ANTHROPIC_API_KEY=

# Optional provider and model overrides. Mock is the safe default.
# PARALLAX_PROVIDER=mock
# PARALLAX_MODEL=
# openai-compatible also needs baseUrl in <store>/.local/providers.yaml
# claude requires an explicit model via preset, --model, or PARALLAX_MODEL
`;

const ENV_VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;
const OWNER_ONLY_MODE = 0o600;

export function envPath(projectRoot: string): string {
  return join(projectRoot, ENV_FILE_NAME);
}

/**
 * Load `<project-root>/.env` into `process.env`.
 * Existing shell environment variables take precedence.
 */
export function loadProjectEnv(projectRoot: string): void {
  loadDotenv({
    path: envPath(projectRoot),
    override: false,
    quiet: true,
  });
}

export async function envFileExists(projectRoot: string): Promise<boolean> {
  try {
    await readFile(envPath(projectRoot));
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function setOwnerOnlyPermissions(path: string): Promise<void> {
  try {
    await chmod(path, OWNER_ONLY_MODE);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw error;
    }
    // Permissions are best-effort where the platform supports Unix modes.
  }
}

async function writeEnvFile(path: string, contents: string): Promise<void> {
  try {
    await writeFile(path, contents, { encoding: "utf8", mode: OWNER_ONLY_MODE });
    await setOwnerOnlyPermissions(path);
  } catch {
    throw new Error(`Failed to write ${ENV_FILE_NAME}.`);
  }
}

export function upsertEnvVariable(
  contents: string,
  variable: string,
  value: string,
): string {
  if (!ENV_VARIABLE_NAME.test(variable)) {
    throw new Error("Invalid environment variable name.");
  }
  const assignment = new RegExp(`^(?:export\\s+)?${variable}\\s*=.*$`, "m");
  const line = `${variable}=${value}`;
  if (assignment.test(contents)) {
    return contents.replace(assignment, line);
  }
  const base =
    contents.endsWith("\n") || contents.length === 0 ? contents : `${contents}\n`;
  return `${base}${line}\n`;
}

export type CreateEnvFromTemplateResult =
  { created: true; path: string } | { created: false; path: string; reason: "exists" };

/**
 * Create `.env` from the template only when it is absent.
 * Never overwrites an existing file.
 */
export async function createEnvFromTemplate(
  projectRoot: string,
): Promise<CreateEnvFromTemplateResult> {
  const path = envPath(projectRoot);
  if (await envFileExists(projectRoot)) {
    return { created: false, path, reason: "exists" };
  }
  await writeEnvFile(path, ENV_EXAMPLE_CONTENTS);
  return { created: true, path };
}

export interface PromptIO {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

function requireTty(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  action: string,
): void {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(
      `A TTY is required to ${action}. Set the provider API key in the environment or create ${ENV_FILE_NAME} manually.`,
    );
  }
}

export async function promptSecret(prompt: string, io: PromptIO = {}): Promise<string> {
  const stdin = io.stdin ?? defaultStdin;
  const stdout = io.stdout ?? defaultStdout;
  requireTty(stdin, stdout, "enter an API key securely");

  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    const wasRaw = stdin.isRaw === true;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";

    const cleanup = (): void => {
      stdin.off("data", onData);
      if (stdin.isTTY) {
        stdin.setRawMode?.(wasRaw);
      }
      stdin.pause();
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (char < " ") {
          continue;
        }
        value += char;
      }
    };

    stdin.on("data", onData);
  });
}

export async function confirmOverwrite(
  message: string,
  io: PromptIO = {},
): Promise<boolean> {
  const stdin = io.stdin ?? defaultStdin;
  const stdout = io.stdout ?? defaultStdout;
  requireTty(stdin, stdout, `confirm overwriting ${ENV_FILE_NAME}`);

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export interface WriteApiKeyOptions extends PromptIO {
  projectRoot: string;
  apiKeyEnv: string;
  /** Injected for tests; defaults to a secure TTY prompt. */
  readSecret?: (prompt: string) => Promise<string>;
  /** Injected for tests; defaults to an interactive yes/no prompt. */
  confirm?: (message: string) => Promise<boolean>;
}

export type WriteApiKeyResult =
  | { written: true; path: string; created: boolean }
  | { written: false; path: string; reason: "declined" };

/**
 * Prompt for an API key and write the selected provider variable to `.env`.
 * Existing `.env` files require an explicit confirmation before modification.
 */
export async function writeApiKeyToEnv(
  options: WriteApiKeyOptions,
): Promise<WriteApiKeyResult> {
  const path = envPath(options.projectRoot);
  const exists = await envFileExists(options.projectRoot);
  const io = { stdin: options.stdin, stdout: options.stdout };
  if (!ENV_VARIABLE_NAME.test(options.apiKeyEnv)) {
    throw new Error("Invalid API key environment variable.");
  }

  if (exists) {
    const confirm =
      options.confirm ?? ((message: string) => confirmOverwrite(message, io));
    const approved = await confirm(
      `${ENV_FILE_NAME} already exists. Update ${options.apiKeyEnv}?`,
    );
    if (!approved) {
      return { written: false, path, reason: "declined" };
    }
  }

  const readSecret =
    options.readSecret ?? ((prompt: string) => promptSecret(prompt, io));
  const apiKey = (await readSecret(`${options.apiKeyEnv}: `)).trim();
  if (apiKey.length === 0) {
    throw new Error("API key cannot be empty.");
  }

  const previous = exists ? await readFile(path, "utf8") : ENV_EXAMPLE_CONTENTS;
  const next = upsertEnvVariable(previous, options.apiKeyEnv, apiKey);
  await writeEnvFile(path, next);

  return { written: true, path, created: !exists };
}

/**
 * Reject `init --api-key <value>` and `init --api-key=<value>` so secrets
 * never land in shell history or process listings.
 */
export function assertApiKeyNotPassedOnCli(args: string[]): void {
  const equalsForm = args.find((argument) => argument.startsWith("--api-key="));
  if (equalsForm !== undefined) {
    throw new Error(
      "Do not pass the API key on the command line. Run `parallax init --api-key` and enter it when prompted, or set OPENAI_API_KEY in the environment or create .env manually.",
    );
  }

  const index = args.indexOf("--api-key");
  if (index === -1) {
    return;
  }
  const next = args[index + 1];
  if (next !== undefined && !next.startsWith("-")) {
    throw new Error(
      "Do not pass the API key on the command line. Run `parallax init --api-key` and enter it when prompted, or set OPENAI_API_KEY in the environment or create .env manually.",
    );
  }
}
