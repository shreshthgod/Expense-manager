import { defineWorkspace } from "vitest/config";

/**
 *  - unit:        pure functions, no database (fast, parallel)
 *  - integration: real route handlers against a real PostgreSQL test database
 *                 (TEST_DATABASE_URL, reset from the migrations), run sequentially.
 */
export default defineWorkspace([
  {
    extends: "./vitest.config.ts",
    test: {
      name: "unit",
      include: ["tests/unit/**/*.test.ts"],
    },
  },
  {
    extends: "./vitest.config.ts",
    test: {
      name: "integration",
      include: ["tests/integration/**/*.test.ts"],
      globalSetup: ["tests/helpers/global-setup.ts"],
      setupFiles: ["tests/helpers/setup-integration.ts"],
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
      testTimeout: 60_000,
      hookTimeout: 180_000,
    },
  },
]);
