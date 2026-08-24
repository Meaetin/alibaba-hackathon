// Flat config. `next lint` is deprecated in Next 15 and removed in 16, so the
// `lint` script calls the ESLint CLI directly.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "typescript-eslint";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**", "scripts/output/**", "next-env.d.ts"],
  },
  // `next/core-web-vitals` carries the React Hooks rules, which are the reason
  // this config exists: 160-odd components, and nothing else checks a dep array.
  ...compat.extends("next/core-web-vitals"),
  ...tseslint.configs.recommended,
  {
    rules: {
      // Underscore marks a binding that is deliberately unused — a value
      // destructured only to keep it out of a `...props` DOM spread, or a
      // handler argument the signature requires and the body ignores.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Test doubles need to name shapes loosely, and a fixture cast is not a
    // design smell. The planner's production code stays under the full rules.
    files: ["**/*.test.ts", "**/*.test.tsx", "src/lib/planner/__tests__/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
