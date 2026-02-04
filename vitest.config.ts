import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "clarinet",
    pool: "threads",
    poolOptions: {
      threads: { singleThread: true },
    },
    setupFiles: [
      "node_modules/@stacks/clarinet-sdk/vitest-helpers/src/vitest.setup.ts",
    ],
    coverage: {
      enabled: false,
    },
    environmentOptions: {
      clarinet: {
        manifestPath: "Clarinet.toml",
        coverage: false,
        costs: false,
        coverageFilename: "lcov.info",
        costsFilename: "costs-reports.json",
      },
    },
  },
});
