import nextPlugin from "@next/eslint-plugin-next";

// Native ESLint 9 flat config. We load @next/eslint-plugin-next directly instead
// of going through FlatCompat + the legacy eslintrc shareable configs: under
// ESLint 9.39 the eslintrc config-validator chokes on eslint-plugin-react's
// self-referential flat configs ("Converting circular structure to JSON"),
// which crashed `next lint` entirely. Type correctness is covered separately by
// the `tsc --noEmit` typecheck step, so this config focuses on Next.js rules.
export default [
  {
    ignores: [".next/**", "node_modules/**", "out/**"],
  },
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
];
