import xoReact from 'eslint-config-xo-react';
import type {XoConfigItem} from 'xo';

const xoConfig: XoConfigItem[] = [
	{
		ignores: [
			'**/*.md',
			'dist/**',
			'docs/**',
			'coverage/**',
			'.proof/**',
			'test-results/**',
			'playwright-report/**',
			'.agents/**',
			'.claude/worktrees/**',
			'.unslop/**',
			'skills-lock.json',
		],
	},
	{prettier: true},
	...(xoReact({prettier: true}) as XoConfigItem[]),
	{files: ['**/*.tsx'], settings: {react: {version: 'detect'}}},
	{
		files: ['**/*.{ts,tsx,mts,cts}'],
		languageOptions: {
			parserOptions: {
				projectService: false,
				project: [
					'./tsconfig/app.json',
					'./tsconfig/test.json',
					'./tsconfig/node.json',
				],
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		languageOptions: {globals: {window: 'readonly'}},
	},
	{
		rules: {
			'@typescript-eslint/strict-boolean-expressions': 'off',
			'@typescript-eslint/prefer-nullish-coalescing': 'off',
			'@typescript-eslint/no-restricted-types': 'off',
			'@typescript-eslint/no-base-to-string': 'off',
			'@typescript-eslint/promise-function-async': 'off',
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/strict-void-return': 'off',
			'@typescript-eslint/no-confusing-void-expression': [
				'error',
				{ignoreArrowShorthand: true},
			],
			'@stylistic/curly-newline': 'off',
			'@stylistic/no-mixed-operators': 'off',
			'no-useless-escape': 'off',
			'unicorn/prefer-block-statement-over-iife': 'off',
			'@typescript-eslint/no-empty-object-type': [
				'error',
				{allowObjectTypes: 'always'},
			],
			'@typescript-eslint/consistent-type-assertions': [
				'error',
				{assertionStyle: 'as', objectLiteralTypeAssertions: 'allow'},
			],
			'@typescript-eslint/switch-exhaustiveness-check': [
				'error',
				{considerDefaultExhaustiveForUnions: true},
			],
			'no-void': 'off',
			eqeqeq: ['error', 'always', {null: 'ignore'}],
			'no-eq-null': 'off',
			'n/file-extension-in-import': 'off',
			'require-unicode-regexp': 'off',
			'regexp/prefer-named-capture-group': 'off',
			'unicorn/prefer-unicode-code-point-escapes': 'off',
			'regexp/no-super-linear-backtracking': 'off',
			'regexp/no-super-linear-move': 'off',
			'regexp/no-contradiction-with-assertion': 'off',
			complexity: 'off',
			'max-params': 'off',
			'max-lines': 'off',
			'max-depth': 'off',
			'unicorn/max-nested-calls': 'off',
			'no-await-in-loop': 'off',
			'unicorn/no-await-expression-member': 'off',
			'unicorn/consistent-boolean-name': 'off',
			'unicorn/name-replacements': 'off',
			'unicorn/catch-error-name': 'off',
			'unicorn/prefer-simple-condition-first': 'off',
			'unicorn/prefer-else-if': 'off',
			'@typescript-eslint/prefer-optional-chain': 'off',
			'unicorn/no-unreadable-array-destructuring': 'off',
			'unicorn/prefer-then-catch': 'off',
			'unicorn/no-immediate-mutation': 'off',
			'unicorn/no-break-in-nested-loop': 'off',
			'unicorn/no-object-as-default-parameter': 'off',
			'unicorn/prefer-number-coercion': 'off',
			'unicorn/prefer-iterator-to-array': 'off',
			'unicorn/prefer-iterator-helpers': 'off',
			'unicorn/prefer-set-methods': 'off',
			'unicorn/prefer-spread': 'off',
			'unicorn/no-useless-coercion': 'off',
			'@typescript-eslint/no-unnecessary-type-conversion': 'off',
			'unicorn/no-unnecessary-global-this': 'off',
			'unicorn/prefer-top-level-await': 'off',
			'react-hooks/set-state-in-effect': 'off',
			'react-hooks/refs': 'off',
			'@eslint-react/no-array-index-key': 'off',
			'jsx-a11y-x/label-has-associated-control': [
				'error',
				{controlComponents: ['Checkbox']},
			],
			'jsx-a11y-x/no-autofocus': 'off',
		},
	},
	{
		files: ['index.html'],
		rules: {
			'@html-eslint/require-open-graph-protocol': 'off',
		},
	},
	{
		files: ['package.json'],
		rules: {
			'package-json/prefer-shorthand': 'off',
			'package-json/dependency-version-range': 'off',
		},
	},
	{
		files: ['tsconfig.json', 'tsconfig/*.json'],
		language: 'json/jsonc',
	},
	{
		files: ['src/styles/**/*.css'],
		languageOptions: {
			customSyntax: {
				atrules: {
					theme: {prelude: '<ident>*'},
					source: {prelude: '<string> | not <string>'},
				},
			},
		},
	},
	{
		files: ['src/components/ui/**'],
		rules: {
			'@eslint-react/no-forward-ref': 'off',
			'@eslint-react/no-context-provider': 'off',
			'@eslint-react/no-use-context': 'off',
			'@eslint-react/naming-convention-ref-name': 'off',
			'@eslint-react/naming-convention-id-name': 'off',
			'jsx-a11y-x/heading-has-content': 'off',
		},
	},
	{
		files: [
			'src/**/*.test.ts',
			'src/**/*.test.tsx',
			'tests/**',
			'scripts/**/*.test.ts',
		],
		rules: {
			'@typescript-eslint/naming-convention': 'off',
			'@eslint-react/naming-convention-context-name': 'off',
			'no-script-url': 'off',
		},
	},
];

export default xoConfig;
