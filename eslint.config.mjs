import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';

export default [
  {
    languageOptions: {
      globals: globals.node,
      // No parserOptions.project: no rule here needs type information, and
      // building it took 2 to 3 GB per lint run (out of memory on CI).
    },
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    ignores: ['dist/', '*.config.ts', '*.config.mjs', 'eslint.config.mjs'],
  },
  {
    rules: {
      // Allow underscore-prefixed unused vars (common convention for intentionally unused params)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
