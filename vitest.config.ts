import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@pf/core": r("packages/core/src/index.ts"),
      "@pf/dbx": r("packages/dbx/src/index.ts"),
      "@pf/adapters": r("packages/adapters/src/index.ts"),
    },
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "app/server/**/*.test.ts",
      "tests/golden/**/*.test.ts",
    ],
    environment: "node",
  },
});
