import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "next-env.d.ts",
      "src/core/costing/__tests__/golden/*.json",
    ],
  },
  {
    // Purity is the architectural requirement of the costing engine (Phase
    // 3): no database, no Redis, no fetch, no clock, no randomness, no
    // environment access. Enforced here, not just by convention, so a
    // future accidental `import { redis } from "@/lib/redis"` fails CI
    // instead of quietly breaking determinism. Scoped to the engine files
    // only — __tests__/ legitimately needs vitest and fixture data.
    files: ["src/core/costing/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "@/*"],
              message: "The costing engine must stay pure — no imports outside src/core/costing/.",
            },
          ],
          paths: [
            "fs", "node:fs", "fs/promises", "node:fs/promises",
            "child_process", "node:child_process",
            "http", "node:http", "https", "node:https",
            "dns", "node:dns", "net", "node:net",
            "pg", "ioredis", "next", "next/server",
          ].map((name) => ({
            name,
            message: "The costing engine must stay pure — no I/O, network, or framework imports.",
          })),
        },
      ],
    },
  },
];

export default config;
