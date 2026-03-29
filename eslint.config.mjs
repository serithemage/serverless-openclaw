import js from "@eslint/js";
import tseslint from "typescript-eslint";

const nodeScriptGlobals = {
  AbortController: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  fetch: "readonly",
  process: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["**/dist/", "**/cdk.out/", "**/node_modules/"] },
  {
    files: ["scripts/**/*.{js,mjs}", "*.config.{js,mjs}", "eslint.config.mjs"],
    languageOptions: {
      globals: nodeScriptGlobals,
    },
  },
);
