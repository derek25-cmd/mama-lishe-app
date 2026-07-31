import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Separate from vitest.config.ts (unit tests + costing core) because this
// suite needs Docker (Testcontainers spins up real, disposable Postgres +
// Redis) and takes real wall-clock time to boot containers — CI runs it as
// its own gated step, not bundled into the fast unit-test loop.
export default defineConfig({
  resolve: {
    // Next.js resolves "@/*" -> "./src/*" via tsconfig paths at build time;
    // Vitest doesn't read tsconfig paths on its own, so route/lib imports
    // under test need the same alias spelled out here.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // The lib/auth unit tests (phone/jwt/pkce — no container needed) run
    // here too, not just in vitest.config.ts, so the 90% threshold below is
    // measured against the true combined coverage of lib/auth/ rather than
    // undercounting files the integration suite alone doesn't fully exercise.
    include: ["test/integration/**/*.test.ts", "src/lib/auth/**/*.test.ts"],
    globalSetup: ["test/integration-global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false, // shared Postgres/Redis containers — tests must not race each other
    coverage: {
      provider: "v8",
      include: ["src/lib/auth/**/*.ts"],
      exclude: ["src/lib/auth/**/*.test.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
        branches: 90,
        functions: 90,
      },
    },
  },
});
