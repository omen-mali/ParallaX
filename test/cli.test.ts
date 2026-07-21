import { describe, expect, it } from "vitest";

import { packageName } from "../src/index.js";

describe("package metadata", () => {
  it("uses the scoped package name", () => {
    expect(packageName).toBe("@omen-mali/parallax");
  });
});
