import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import prettierRecommended from 'eslint-plugin-prettier/recommended'
import importPlugin from 'eslint-plugin-import'
import nPlugin from 'eslint-plugin-n'
import globals from 'globals'

/**
 * ESLint 9 flat config, mapped from the former .eslintrc + .eslintignore.
 * `--ext` is not valid in flat config; file globs below replace it.
 */
export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'eslint.config.mjs',
      'design/**',
      'packages/api/src/client/**',
      'packages/lexicon-resolver/src/client/**',
      'packages/bsky/src/lexicon/**',
      'packages/pds/src/lexicon/**',
      'packages/ozone/src/lexicon/**',
      'packages/notes/src/lexicon/**',
    ],
  },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  prettierRecommended,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      n: nPlugin,
    },
    settings: {
      node: { version: '>=18.7.0' },
      'import/internal-regex': '^@atproto(?:-labs)?/',
      'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
      'import/resolver': {
        typescript: {
          project: [
            'tsconfig.json',
            'packages/oauth/*/tsconfig.json',
            'packages/oauth/*/tsconfig.src.json',
            'packages/internal/*/tsconfig.json',
            'packages/*/tsconfig.json',
          ],
        },
        node: {
          extensions: ['.js', '.jsx', '.json'],
        },
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-misleading-character-class': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'n/global-require': 'error',
      'n/no-extraneous-import': 'error',
      'n/prefer-node-protocol': 'error',
      'import/extensions': ['off', 'ignorePackages'],
      'import/export': 'off',
      'import/namespace': 'off',
      'import/no-deprecated': 'error',
      'import/no-absolute-path': 'error',
      'import/no-dynamic-require': 'error',
      'import/no-self-import': 'error',
      'import/order': [
        'error',
        {
          named: true,
          distinctGroup: true,
          alphabetize: { order: 'asc' },
          'newlines-between': 'never',
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            ['index', 'sibling'],
            'object',
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['jest.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: ['vite.config.js', 'vite.config.cjs', 'vite.config.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['jest.setup.js'],
    languageOptions: {
      globals: globals.jest,
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      // typescript-eslint v8 renamed no-var-requires -> no-require-imports
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/tests/**/*.ts'],
    rules: {
      'n/no-extraneous-import': [
        'error',
        { allowModules: ['@atproto/dev-env'] },
      ],
    },
  },
]
