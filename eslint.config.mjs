// Lint (pnpm lint): the rules typecheck cannot enforce. Hooks: their order and their dependencies.
// Promises: none left floating, none where a callback's return is ignored (JSX handlers excepted:
// React ignores what they return, and an async onClick is the usual way to write one).
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // src/vendor: third-party code kept as upstream wrote it (each folder's README says what changed).
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'src/vendor/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    },
  },
  // The page script (entrypoints/page-agent.ts and what it runs) stays without the model's texts:
  // clip from core/clip, the marks from core/origin-marks. Types are free.
  {
    files: ['src/content/**/*.ts', 'src/entrypoints/page-agent.ts', 'src/templates/liquid.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core/model-texts', '**/core/truncate', '**/core/texts/*'],
              message: 'The page script must not bundle TEXT_DEFS: import from core/clip or core/origin-marks.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
);
