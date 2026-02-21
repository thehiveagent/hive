import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            // TypeScript
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_"
            }],
            "@typescript-eslint/consistent-type-imports": ["error", {
                prefer: "type-imports"
            }],
            "@typescript-eslint/no-non-null-assertion": "warn",

            // General
            "no-console": "off",
            "prefer-const": "error",
            "no-var": "error",
            "eqeqeq": ["error", "always"],
            "curly": ["error", "all"],
        },
    },
    {
        ignores: ["dist/**", "node_modules/**", "*.js"],
    }
);