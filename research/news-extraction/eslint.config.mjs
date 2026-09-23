// Root rules (../../eslint.config.mjs) for this research prototype.
import { defineConfig } from "eslint/config";
import rootConfig from "../../eslint.config.mjs";

export default defineConfig(
  rootConfig,
  {
    // Resolve tsconfigs (and allowDefaultProject globs) from this package.
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // CLI script reports progress on stdout.
    files: ["extract.ts"],
    rules: { "no-console": "off" },
  },
);
