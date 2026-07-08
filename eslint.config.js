const js = require("@eslint/js");
const globals = require("globals");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = [
  js.configs.recommended,
  eslintConfigPrettier, // turn off stylistic rules that would conflict with Prettier

  {
    ignores: ["node_modules/**", "backend/node_modules/**", "**/package-lock.json", "docs/css/**"],
  },

  // Tooling/config files at the repo root (this file itself)
  {
    files: ["*.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },

  // Backend: Node.js, CommonJS
  {
    files: ["backend/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_?err$|^_" }],
      "no-console": "off", // this backend logs intentionally (startup warnings, cron status, error diagnostics)
    },
  },

  // Backend tests: same as backend, plus Node's test-runner globals
  {
    files: ["backend/test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },

  // Frontend: plain browser scripts loaded via <script src>, NOT ES modules —
  // they intentionally share one global scope, so cross-file references to
  // functions/variables declared in another docs/js/*.js file are expected
  // and not a real "undefined" bug. See docs/js/README (script load order in
  // docs/index.html) for why this is safe.
  {
    files: ["docs/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        Chart: "readonly",
        status: "off", // this app's own `let status` (loading/live/err) shadows window.status by design
      },
    },
    rules: {
      // Disabled: top-level consts/functions here are legitimately consumed
      // from sibling docs/js/*.js files and from inline onclick="" handlers,
      // so per-file "unused" analysis produces constant false positives given
      // this project's plain multi-<script> architecture (see docs/index.html).
      "no-unused-vars": "off",
      "no-undef": "off", // cross-file globals are the intended design here, not accidental
      "no-empty": ["error", { allowEmptyCatch: true }], // e.g. try { localStorage... } catch(e) {} guards
    },
  },
];
