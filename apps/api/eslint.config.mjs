import tseslint from 'typescript-eslint';

// Native ESLint 9 flat config for the API (the web app has its own, Next-flavoured
// one). Type-aware linting is enabled because the rules that actually matter here
// need types: a forgotten `await` on a Prisma call is the exact shape of the async
// bugs this codebase must not ship. `tsc --noEmit` stays the source of truth for
// type errors — this config focuses on what the compiler cannot see.
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.turbo/**', 'prisma/**'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Fire-and-forget is used deliberately (push notifications, cache writes);
      // it must be marked with `void`, never left dangling.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      // `_name` marks a deliberate discard — notably the destructuring-omit idiom
      // used in the env-validation specs.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Reports false positives on the `as unknown` widening that jest.fn() mocks
      // need to accept later mockResolvedValueOnce shapes — autofixing it breaks
      // the typecheck. Cosmetic rule, real risk: off.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Nest decorators and Prisma's generated types make these too noisy to be
      // useful signal; the typecheck step already guards real type breakage.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
