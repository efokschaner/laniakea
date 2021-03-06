const packageJson = require('./package.json');

// Rules common to JS and TS
let commonRules = {
  'arrow-body-style': 'error',
  'arrow-parens': ['error', 'always'],
  complexity: 'off',
  'constructor-super': 'error',
  curly: 'error',
  'eol-last': 'error',
  eqeqeq: ['error', 'smart'],
  'guard-for-in': 'error',
  'id-blacklist': [
    'error',
    'any',
    'Number',
    'number',
    'String',
    'string',
    'Boolean',
    'boolean',
    'Undefined',
    'undefined',
  ],
  'id-match': 'error',
  'import/order': 'error',
  'max-classes-per-file': 'off',
  'new-parens': 'error',
  'no-bitwise': 'error',
  'no-caller': 'error',
  'no-cond-assign': 'error',
  'no-console': 'off',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-debugger': 'error',
  'no-empty': 'error',
  'no-eval': 'error',
  'no-fallthrough': 'off',
  'no-invalid-this': 'off',
  'no-multiple-empty-lines': 'error',
  'no-new-wrappers': 'error',
  'no-throw-literal': 'error',
  'no-trailing-spaces': 'error',
  'no-undef-init': 'error',
  'no-unsafe-finally': 'error',
  'no-unused-labels': 'error',
  'no-var': 'error',
  'object-shorthand': 'error',
  'one-var': ['error', 'never'],
  'prefer-const': 'off',
  'quote-props': ['error', 'as-needed'],
  radix: 'error',
  'use-isnan': 'error',
  'valid-typeof': 'off',
};

module.exports = {
  env: {
    browser: true,
    es6: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'prettier',
  ],
  plugins: ['eslint-plugin-jsdoc', 'eslint-plugin-import'],
  rules: commonRules,
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      env: {
        browser: true,
        es6: true,
        node: true,
      },
      extends: [
        'eslint:recommended',
        'plugin:import/errors',
        'plugin:import/warnings',
        'plugin:import/typescript',
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
        'prettier',
      ],
      plugins: [
        'eslint-plugin-jsdoc',
        'eslint-plugin-import',
        '@typescript-eslint',
      ],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: packageJson.workspaces.map((x) => x + '/**/tsconfig.json'),
        sourceType: 'module',
      },
      rules: Object.assign({}, commonRules, {
        '@typescript-eslint/adjacent-overload-signatures': 'error',
        '@typescript-eslint/consistent-type-assertions': 'error',
        '@typescript-eslint/consistent-type-definitions': 'error',
        '@typescript-eslint/dot-notation': 'error',
        '@typescript-eslint/explicit-member-accessibility': [
          'error',
          {
            accessibility: 'explicit',
          },
        ],
        '@typescript-eslint/member-delimiter-style': [
          'error',
          {
            multiline: {
              delimiter: 'semi',
              requireLast: true,
            },
            singleline: {
              delimiter: 'semi',
              requireLast: false,
            },
          },
        ],
        '@typescript-eslint/no-empty-function': 'error',
        '@typescript-eslint/no-empty-interface': 'error',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-misused-new': 'error',
        '@typescript-eslint/no-namespace': 'error',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-shadow': [
          'error',
          {
            hoist: 'all',
          },
        ],
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unused-expressions': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { varsIgnorePattern: '^_.*', argsIgnorePattern: '^_.*' },
        ],
        '@typescript-eslint/no-var-requires': 'error',
        '@typescript-eslint/prefer-for-of': 'error',
        '@typescript-eslint/prefer-function-type': 'error',
        '@typescript-eslint/prefer-namespace-keyword': 'error',
        '@typescript-eslint/semi': ['error', 'always'],
        '@typescript-eslint/triple-slash-reference': [
          'error',
          {
            path: 'always',
            types: 'prefer-import',
            lib: 'always',
          },
        ],
        '@typescript-eslint/unified-signatures': 'error',
      }),
    },
  ],
};
