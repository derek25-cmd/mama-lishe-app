import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/core/costing/**/*.ts"],
      exclude: ["src/core/costing/**/*.test.ts", "src/core/costing/__fixtures__/**"],
      thresholds: {
        lines: 100,
        statements: 100,
        branches: 100,
        functions: 100,
      },
    },
  },
});
