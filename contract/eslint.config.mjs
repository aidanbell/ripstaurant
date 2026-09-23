// Root rules (../eslint.config.mjs) plus Bun runtime specifics.
import { defineConfig } from "eslint/config";
import rootConfig from "../eslint.config.mjs";

export default defineConfig(
  rootConfig,
  {
    // Resolve tsconfigs (and allowDefaultProject globs) from this package.
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
    // Bun's built-in modules, which the TypeScript import resolver doesn't know about.
    settings: { "import-x/core-modules": ["bun:test"] },
  },
  {
    // CLI scripts report progress on stdout.
    files: ["scripts/**"],
    rules: { "no-console": "off" },
  },
);
