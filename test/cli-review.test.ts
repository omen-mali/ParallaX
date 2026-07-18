import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli, type CliDependencies, type CliIO } from "../src/cli.js";
import type { ImportDelta } from "../src/contract/types.js";
import type { Distiller } from "../src/importer/distiller.js";

const reviewChat = `# Review import

## User

Decision evidence
Task evidence
Question evidence
Glossary evidence
Spec evidence
`;

const allItemTypes: ImportDelta = {
  summary: "A proposal that exercises every supported review item type.",
  decisions: [
    {
      title: "Keep review selections in memory",
      context: "The review session is transient.",
      decision: "Keep review selections in memory.",
      rationale: "The user selected the decision.",
      alternatives: [],
      supersedes: null,
      tags: ["review"],
      evidence: { turnIndex: 0, quote: "Decision evidence" },
    },
  ],
  tasks: [
    {
      title: "Test selected tasks",
      detail: "Review only the selected task.",
      evidence: { turnIndex: 0, quote: "Task evidence" },
    },
  ],
  questions: [
    {
      question: "Should review be TTY-only?",
      evidence: { turnIndex: 0, quote: "Question evidence" },
    },
  ],
  glossary: [
    {
      term: "review key",
      definition: "A stable key for one proposal item.",
      evidence: { turnIndex: 0, quote: "Glossary evidence" },
    },
  ],
  specChanges: [
    {
      section: "Import review",
      operation: "add",
      content: "Selections are made in one session.",
      evidence: { turnIndex: 0, quote: "Spec evidence" },
    },
  ],
};

function inputStream(isTTY: boolean): NodeJS.ReadStream {
  const stream = new Readable({ read() {} }) as NodeJS.ReadStream;
  Object.defineProperty(stream, "isTTY", { value: isTTY });
  return stream;
}

function outputStream(isTTY: boolean): {
  stream: NodeJS.WriteStream;
  contents: () => string;
} {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString("utf8");
      callback();
    },
  }) as NodeJS.WriteStream;
  Object.defineProperty(stream, "isTTY", { value: isTTY });
  return { stream, contents: () => output };
}

function ttyIo(): { io: CliIO; output: () => string } {
  const output = outputStream(true);
  return {
    io: { stdin: inputStream(true), stdout: output.stream },
    output: output.contents,
  };
}

function nonTtyIo(): CliIO {
  return { stdin: inputStream(false), stdout: outputStream(false).stream };
}

async function projectWithChat(): Promise<{ root: string; chatPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "parallax-review-cli-"));
  const chatPath = join(root, "chat.md");
  await writeFile(chatPath, reviewChat, "utf8");
  return { root, chatPath };
}

function reviewArgs(root: string, chatPath: string, extra: string[] = []): string[] {
  return ["import", chatPath, "--root", root, "--mock", "--review", ...extra];
}

function dependenciesFor(candidate: ImportDelta = allItemTypes): {
  dependencies: CliDependencies;
  createDistiller: ReturnType<typeof vi.fn>;
  distill: ReturnType<typeof vi.fn>;
} {
  const distill = vi.fn(async () => candidate);
  const distiller: Distiller = { provider: "mock", distill };
  const createDistiller = vi.fn(async () => distiller);
  return {
    dependencies: {
      createDistiller: createDistiller as CliDependencies["createDistiller"],
    },
    createDistiller,
    distill,
  };
}

function scriptedPrompt(...answers: string[]): (question: string) => Promise<string> {
  return async () => {
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error("Review asked for an unexpected additional answer.");
    }
    return answer;
  };
}

async function expectNoStore(root: string): Promise<void> {
  await expect(access(join(root, ".parallax"))).rejects.toMatchObject({
    code: "ENOENT",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CLI selectable import review", () => {
  it("distills once, makes no network call, and applies every selected item type", async () => {
    const { root, chatPath } = await projectWithChat();
    const { io, output } = ttyIo();
    const { dependencies, createDistiller, distill } = dependenciesFor();
    const prompt = vi.fn(scriptedPrompt("d1, t1, q1, g1, s1", "YES"));
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Mock review must not access the network."));

    await runCli(reviewArgs(root, chatPath), io, {
      ...dependencies,
      reviewPrompt: prompt,
    });

    expect(createDistiller).toHaveBeenCalledTimes(1);
    expect(distill).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenLastCalledWith("Apply 5 selected items? [y/N]");
    expect(output()).toContain("d1");
    expect(output()).toContain("t1");
    expect(output()).toContain("q1");
    expect(output()).toContain("g1");
    expect(output()).toContain("s1");
    expect(output()).toContain("Applied 5 selected items to");

    const storeRoot = join(root, ".parallax");
    await expect(readdir(join(storeRoot, "sources"))).resolves.toHaveLength(1);
    await expect(readdir(join(storeRoot, "decisions"))).resolves.toHaveLength(1);
    await expect(readFile(join(storeRoot, "tasks.md"), "utf8")).resolves.toContain(
      "Test selected tasks",
    );
    await expect(readFile(join(storeRoot, "questions.md"), "utf8")).resolves.toContain(
      "Should review be TTY-only?",
    );
    await expect(readFile(join(storeRoot, "glossary.md"), "utf8")).resolves.toContain(
      "review key",
    );
    await expect(
      readFile(join(storeRoot, "spec-changes.md"), "utf8"),
    ).resolves.toContain("Import review");
  });

  it("applies only the selected subset and preserves metadata-only retention", async () => {
    const { root, chatPath } = await projectWithChat();
    const { io } = ttyIo();
    const { dependencies } = dependenciesFor();

    await runCli(reviewArgs(root, chatPath, ["--metadata-only"]), io, {
      ...dependencies,
      reviewPrompt: scriptedPrompt("d1, q1", "y"),
    });

    const storeRoot = join(root, ".parallax");
    await expect(readdir(join(storeRoot, "decisions"))).resolves.toHaveLength(1);
    await expect(readFile(join(storeRoot, "tasks.md"), "utf8")).resolves.toBe(
      "# ParallaX Tasks\n",
    );
    await expect(readFile(join(storeRoot, "questions.md"), "utf8")).resolves.toContain(
      "Should review be TTY-only?",
    );
    await expect(readFile(join(storeRoot, "glossary.md"), "utf8")).resolves.toBe(
      "# ParallaX Glossary\n",
    );
    await expect(readFile(join(storeRoot, "spec-changes.md"), "utf8")).resolves.toBe(
      "# ParallaX Spec Changes\n",
    );

    const [sourceFile] = await readdir(join(storeRoot, "sources"));
    const source = await readFile(join(storeRoot, "sources", sourceFile ?? ""), "utf8");
    expect(source).toContain("metadataOnly: true");
    expect(source).not.toContain("Decision evidence");
  });

  it("leaves no store for an empty selection or a declined confirmation", async () => {
    const empty = await projectWithChat();
    const emptyIo = ttyIo();
    const emptyDependencies = dependenciesFor();
    const emptyPrompt = vi.fn(scriptedPrompt("   "));

    await runCli(reviewArgs(empty.root, empty.chatPath), emptyIo.io, {
      ...emptyDependencies.dependencies,
      reviewPrompt: emptyPrompt,
    });

    expect(emptyDependencies.distill).toHaveBeenCalledTimes(1);
    expect(emptyPrompt).toHaveBeenCalledTimes(1);
    expect(emptyIo.output()).toMatch(/Nothing was written/i);
    await expectNoStore(empty.root);

    const declined = await projectWithChat();
    const declinedIo = ttyIo();
    const declinedDependencies = dependenciesFor();
    const declinedPrompt = vi.fn(scriptedPrompt("d1", "n"));

    await runCli(reviewArgs(declined.root, declined.chatPath), declinedIo.io, {
      ...declinedDependencies.dependencies,
      reviewPrompt: declinedPrompt,
    });

    expect(declinedDependencies.distill).toHaveBeenCalledTimes(1);
    expect(declinedPrompt).toHaveBeenLastCalledWith("Apply 1 selected items? [y/N]");
    expect(declinedIo.output()).toMatch(/Nothing was written/i);
    await expectNoStore(declined.root);
  });

  it("fails closed for invalid keys without writing", async () => {
    const { root, chatPath } = await projectWithChat();
    const { io } = ttyIo();
    const { dependencies, distill } = dependenciesFor();

    await expect(
      runCli(reviewArgs(root, chatPath), io, {
        ...dependencies,
        reviewPrompt: scriptedPrompt("d1, d2"),
      }),
    ).rejects.toThrow(/unknown.*d2/i);

    expect(distill).toHaveBeenCalledTimes(1);
    await expectNoStore(root);
  });

  it("rejects non-TTY review and conflicting apply before distillation", async () => {
    const nonTty = await projectWithChat();
    const nonTtyDependencies = dependenciesFor();

    await expect(
      runCli(
        reviewArgs(nonTty.root, nonTty.chatPath),
        nonTtyIo(),
        nonTtyDependencies.dependencies,
      ),
    ).rejects.toThrow(/TTY is required/i);
    expect(nonTtyDependencies.createDistiller).not.toHaveBeenCalled();
    await expectNoStore(nonTty.root);

    const conflict = await projectWithChat();
    const conflictDependencies = dependenciesFor();

    await expect(
      runCli(
        reviewArgs(conflict.root, conflict.chatPath, ["--apply"]),
        nonTtyIo(),
        conflictDependencies.dependencies,
      ),
    ).rejects.toThrow("--review cannot be used with --apply.");
    expect(conflictDependencies.createDistiller).not.toHaveBeenCalled();
    await expectNoStore(conflict.root);
  });
});
