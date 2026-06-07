// .eslintrc.cjs – Minimal TypeScript ESLint configuration with ignore for web files
module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    sourceType: "module",
    ecmaVersion: 2022,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  ignorePatterns: ["src/web/**/*"],
  rules: {
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/explicit-function-return-type": "warn",
  },
};
