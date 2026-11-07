import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';


export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    'packages/*/dist/',
    'packages/*/coverage/',
    '**/.eslintcache/',
    '**/.tsbuildinfo/',
    'scripts/',
    'workspaces/',
  ]),
  {
    settings: {
      'import/resolver': {
        typescript: {
          project: 'packages/*/tsconfig.json',
        },
      },
    },
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  tseslint.configs.stylistic,
  stylistic.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@stylistic/operator-linebreak': ['error', 'before', { overrides: { '=': 'after' } }],
      '@stylistic/switch-colon-spacing': ['error', { after: true, before: false }],
      '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
      '@stylistic/jsx-indent-props': ['error', 2],
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/member-delimiter-style': [
        'error',
        {
          multiline: { delimiter: 'semi', requireLast: true },
          singleline: { delimiter: 'semi', requireLast: false },
        },
      ],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/quote-props': ['error', 'as-needed'],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1, maxBOF: 0 }],
      '@stylistic/function-paren-newline': ['error', 'multiline-arguments'],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-definitions': ['off'],
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'object-shorthand': ['error'],
      indent: 'off',
      'array-bracket-newline': ['error', { multiline: true }],
      'comma-dangle': 'off',
      'no-multi-spaces': 'error',
      'object-curly-newline': [
        'error',
        {
          ObjectExpression: { multiline: true, consistent: true },
          ObjectPattern: { multiline: true, consistent: true },
          ImportDeclaration: { multiline: true, consistent: true },
          ExportDeclaration: { multiline: true, consistent: true },
        },
      ],
      'object-curly-spacing': ['error', 'always'],
      'space-in-parens': ['error', 'never'],
      'space-infix-ops': 'error',
      'import/order': [
        'error',
        {
          groups: [
            ['builtin', 'external'],
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-unresolved': [
        'error',
        { ignore: ['^/'] },
      ],
      'import/newline-after-import': ['error', { count: 2 }],
      'import/enforce-node-protocol-usage': ['error', 'always'],
      'import/extensions': [
        'error',
        'ignorePackages',
        {
          js: 'always',
          mjs: 'always',
          cjs: 'always',
          ts: 'never',
          tsx: 'never',
        },
      ],
    },
  },
  {
    files: ['packages/web/**/*.{ts,tsx}'],
    extends: [react.configs.flat.recommended, react.configs.flat['jsx-runtime'], reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    settings: {
      react: { version: 'detect' },
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': ['error'],
    },
  },
  {
    files: ['packages/web/src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
