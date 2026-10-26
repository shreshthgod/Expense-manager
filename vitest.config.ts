import { defineConfig } from "vitest/config";
import path from "path";

/** Shared config; the unit/integration split lives in vitest.workspace.ts. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { environment: "node" },
});
