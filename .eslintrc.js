const js = {
  files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
  extends: ['airbnb-base'],
};

const ts = {
  files: ['**/*.ts', '**/*.mts'],
  plugins: ['@typescript-eslint'],
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  parserOptions: {
    project: './tsconfig.json',
  },
};

module.exports = {
  root: true,
  overrides: [js, ts],
  reportUnusedDisableDirectives: true,
};
