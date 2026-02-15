import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.e2e.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "references/**"],
    passWithNoTests: true,
    hookTimeout: 30000,
  },
});
