import { defineConfig } from "vitest/config";

export default defineConfig({
  poolOptions: {
    threads: { singleThread: true },
    forks: { singleFork: true },
  },
  test: {
    environment: "clarinet",
    pool: "forks",
    setupFiles: [
      "node_modules/@stacks/clarinet-sdk/vitest-helpers/src/vitest.setup.ts",
    ],
    coverage: {
      enabled: false,
    },
  },
});
