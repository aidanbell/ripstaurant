// Root rules (../eslint.config.mjs) plus what the React app needs on top.
import { defineConfig } from "eslint/config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import rootConfig from "../eslint.config.mjs";

export default defineConfig(
  rootConfig,
  {
    // Resolve tsconfigs (and allowDefaultProject globs) from this package.
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
);
