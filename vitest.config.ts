import { defineConfig } from "vitest/config";
import {
  getClarinetVitestsArgv,
  vitestSetupFilePath,
} from "@stacks/clarinet-sdk/vitest";

export default defineConfig({
  test: {
    environment: "clarinet",
    pool: "forks",
    poolOptions: {
      threads: { singleThread: true },
      forks: { singleFork: true },
    },
    setupFiles: [vitestSetupFilePath],
    environmentOptions: {
      clarinet: getClarinetVitestsArgv(),
    },
  },
});
