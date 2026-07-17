import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      PARALLAX_MOCK: "1",
    },
    include: ["test/**/*.test.ts"],
  },
});
