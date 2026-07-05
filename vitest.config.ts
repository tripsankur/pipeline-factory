import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "app/server/**/*.test.ts",
      "tests/golden/**/*.test.ts",
    ],
    environment: "node",
  },
});
