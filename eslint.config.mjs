import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default [
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
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
