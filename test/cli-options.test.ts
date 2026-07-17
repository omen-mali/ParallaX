import { describe, expect, it } from "vitest";

import { optionValue, positionalArguments } from "../src/cli-options.js";

describe("CLI options", () => {
  it("reads value options and excludes their values from positionals", () => {
    const args = [
      "--root",
      "/project",
      "--store",
      ".parallax.local",
      "--provider",
      "mock",
      "--model",
      "test",
      "chat.md",
    ];

    expect(optionValue(args, "--store")).toBe(".parallax.local");
    expect(positionalArguments(args)).toEqual(["chat.md"]);
  });

  it("fails clearly when a value option has no value", () => {
    expect(() => optionValue(["--store"], "--store")).toThrow(
      "--store requires a value.",
    );
    expect(() => optionValue(["--store", "--mock"], "--store")).toThrow(
      "--store requires a value.",
    );
  });
});
