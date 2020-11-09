module.exports = {
    parser: '@typescript-eslint/parser',
    parserOptions: {
        project: './tsconfig.json'
    },
    plugins: ['@typescript-eslint'],
    extends: ['plugin:@typescript-eslint/recommended'],
    rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', {
            ignoreRestSiblings: true
        }],
        '@typescript-eslint/semi': 'error',
        'quotes': 'off',
        '@typescript-eslint/quotes': ['warn', 'single', {
            avoidEscape: true,
            allowTemplateLiterals: true
        }],
        'spaced-comment': ['warn', 'always'],
        'no-cond-assign': ['error', 'always'],
        'no-unused-expressions': 'error',
        'no-unused-vars': ['warn', {
            ignoreRestSiblings: true
        }],
        'quote-props': ['warn', 'as-needed'],
        'no-shadow': ['warn']
    }
};
