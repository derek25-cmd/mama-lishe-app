import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Separate from vitest.integration.config.ts (Phase 2's auth suite) for the
// same reason that one is separate from the plain unit-test config: this
// suite needs Docker (Testcontainers), takes real wall-clock time, and has
// its own coverage scope — Phase 4's Task 6 spec is ≥90% on lib/pos/ and
// the sync route handlers specifically, not the whole app. Reuses the same
// global setup (test/integration-global-setup.ts is fully generic — spins
// up Postgres+Redis, runs every migration, sets env — nothing auth-specific
// in it) so there's exactly one place that logic lives.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["test/pos/**/*.test.ts"],
    globalSetup: ["test/integration-global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false, // shared Postgres/Redis containers — tests must not race each other
    coverage: {
      provider: "v8",
      include: ["src/lib/pos/**/*.ts", "src/app/api/v1/sync/**/*.ts"],
      exclude: ["src/lib/pos/**/*.test.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
        branches: 90,
        functions: 90,
      },
    },
  },
});
