import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["node_modules", "dist", ".dev-data", ".artifacts", "app/pipeline/golden", "playwright-report", "test-results"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["app/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Every rule the pinned plugin recommends (purity, refs, set-state-in-render, immutability,
      // static components and the rest) runs at error severity, per conventions/react.md.
      ...Object.fromEntries(Object.keys(reactHooks.configs.recommended.rules).map((rule) => [rule, "error"])),
    },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
);
