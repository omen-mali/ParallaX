import { describe, expect, it } from "vitest";

import {
  BEGIN_MARKER,
  END_MARKER,
  replaceManagedBlock,
} from "../../src/compiler/compiler.js";

describe("replaceManagedBlock", () => {
  it("creates an absent file", () => {
    expect(replaceManagedBlock("", "context")).toBe(
      `${BEGIN_MARKER}\ncontext\n${END_MARKER}`,
    );
  });

  it("appends to an unmarked file without changing its prefix", () => {
    const existing = "# User content\n";
    expect(replaceManagedBlock(existing, "context")).toBe(
      `${existing}\n${BEGIN_MARKER}\ncontext\n${END_MARKER}\n`,
    );
  });

  it("replaces only the managed region", () => {
    const existing = `before\n${BEGIN_MARKER}\nold\n${END_MARKER}\nafter\n`;
    expect(replaceManagedBlock(existing, "new")).toBe(
      `before\n${BEGIN_MARKER}\nnew\n${END_MARKER}\nafter\n`,
    );
  });

  it("preserves CRLF outside the managed region", () => {
    const existing = `before\r\n${BEGIN_MARKER}\r\nold\r\n${END_MARKER}\r\nafter\r\n`;
    expect(replaceManagedBlock(existing, "new")).toBe(
      `before\r\n${BEGIN_MARKER}\r\nnew\r\n${END_MARKER}\r\nafter\r\n`,
    );
  });

  it.each([
    `${BEGIN_MARKER}\nmissing end`,
    `missing begin\n${END_MARKER}`,
    `${BEGIN_MARKER}\n${END_MARKER}\n${BEGIN_MARKER}\n${END_MARKER}`,
    `${END_MARKER}\n${BEGIN_MARKER}`,
  ])("rejects malformed markers", (existing) => {
    expect(() => replaceManagedBlock(existing, "context")).toThrow();
  });
});
