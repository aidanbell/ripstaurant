import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import { importX } from "eslint-plugin-import-x";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import stylistic from "@stylistic/eslint-plugin";

/**
 * Requires the versions in versions.json (ESLint >= 9.22, typescript-eslint 8,
 * TypeScript >= 5.6). Consuming project:
 *
 *   npm i -D typescript@">=5.6.0" eslint@">=9.22.0" typescript-eslint @eslint/js \
 *     prettier eslint-config-prettier @stylistic/eslint-plugin \
 *     eslint-plugin-import-x eslint-import-resolver-typescript
 */
export default defineConfig(
  globalIgnores(["dist/**", "build/**", "coverage/**", ".next/**"]),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.mjs", "*.js", "*.cjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importX,
      "@stylistic": stylistic,
    },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({ alwaysTryTypes: true }),
      ],
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "import/first": "error",
      "import/newline-after-import": "error",
      "import/no-duplicates": "error",
      "import/no-unresolved": "error",
      "import/order": "error",
      "import/prefer-default-export": "off",
      "import/extensions": "error",
      "import/no-anonymous-default-export": "error",
      "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
      "prefer-const": "error",
      "no-var": "error",
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/method-signature-style": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
      "@stylistic/spaced-comment": "error",
    },
  },
  eslintConfigPrettier,
);
