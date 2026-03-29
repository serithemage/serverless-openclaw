import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const sharedSourceIndex = fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@serverless-openclaw/shared": sharedSourceIndex,
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "references/**",
      "**/*.e2e.test.ts",
      "__tests__/integration/**",
    ],
  },
});
