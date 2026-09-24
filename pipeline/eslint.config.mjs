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
    settings: { "import-x/core-modules": ["bun"] },
  },
  {
    // CLI scripts report progress on stdout.
    files: [
      "src/snapshot.ts",
      "src/reference.ts",
      "src/job.ts",
      "src/report.ts",
      "src/resolve.ts",
      "src/detect.ts",
      "src/claude-check.ts",
    ],
    rules: { "no-console": "off" },
  },
);
