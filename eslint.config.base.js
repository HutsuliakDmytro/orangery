import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * The rules every project in the workspace shares.
 *
 * A factory rather than a config: `tsconfigRootDir` has to be the directory of
 * the project being linted, so that typescript-eslint finds that project's own
 * tsconfig rather than one belonging to a sibling.
 *
 * @param {{ rootDir: string, react?: boolean, ignores?: string[] }} options
 */
export function workspaceConfig({ rootDir, react = false, ignores = [] }) {
  return tseslint.config(
    { ignores: ['dist', 'coverage', 'node_modules', ...ignores] },
    {
      files: ['**/*.{ts,tsx}'],
      extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
      languageOptions: {
        ecmaVersion: 2023,
        globals: react ? globals.browser : globals.node,
        parserOptions: {
          projectService: true,
          tsconfigRootDir: rootDir,
        },
      },
      rules: {
        // CLAUDE.md: no `any` without a `// why:` comment — surfaced as an error so
        // the author has to write the justification and silence it deliberately.
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    ...(react
      ? [
          {
            files: ['**/*.{ts,tsx}'],
            plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
            rules: {
              ...reactHooks.configs.recommended.rules,
              'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
            },
          },
        ]
      : []),
    {
      files: ['vite.config.ts', '*.config.{ts,js}'],
      languageOptions: { globals: globals.node },
    },
    prettier,
  )
}
