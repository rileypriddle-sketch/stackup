import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "clarinet",
    pool: "forks",
    poolOptions: {
      threads: { singleThread: true },
      forks: { singleFork: true },
    },
    setupFiles: [
      "node_modules/@stacks/clarinet-sdk/vitest-helpers/src/vitest.setup.ts",
    ],
  },
});
