// @ts-check
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Fronteras de la arquitectura (G07, G08):
// - Un módulo de C4 no importa el `infrastructure/` de otro módulo.
// - `@nexo/shared` no importa ningún componente.
// - Los componentes (C1, C2, C4, boletería simulada) no se importan entre sí;
//   comparten código solo a través de `@nexo/shared`.
const boundaryElements = [
  {
    type: 'module-layer',
    pattern: 'src/central-core/modules/*/*',
    capture: ['module', 'layer'],
  },
  { type: 'module', pattern: 'src/central-core/modules/*', capture: ['module'] },
  { type: 'shared', pattern: 'src/shared' },
  {
    type: 'component',
    pattern: 'src/(local-coordinator|central-core|reader-client|ticketing-sim)',
    capture: ['component'],
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'src/central-core/web/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': boundaryElements,
      'boundaries/include': ['src/**/*.ts'],
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
        node: true,
      },
    },
    rules: {
      'boundaries/dependencies': [
        2,
        {
          default: 'allow',
          policies: [
            {
              from: { element: { type: 'module-layer' } },
              disallow: {
                to: {
                  element: {
                    type: 'module-layer',
                    captured: { module: '!{{ from.element.captured.module }}', layer: 'infrastructure' },
                  },
                },
              },
              message:
                'El módulo {{ from.element.captured.module }} no puede importar el infrastructure/ de {{ to.element.captured.module }}; use su application/.',
            },
            {
              from: { element: { type: 'shared' } },
              disallow: { to: { element: { types: { anyOf: ['component', 'module', 'module-layer'] } } } },
              message: '@nexo/shared no puede importar componentes.',
            },
            {
              from: { element: { types: { anyOf: ['component', 'module', 'module-layer'] } } },
              disallow: {
                to: {
                  element: {
                    type: 'component',
                    captured: { component: '!{{ from.element.captured.component }}' },
                  },
                },
              },
              message: 'Un componente no importa otro componente; comparta código por @nexo/shared.',
            },
          ],
        },
      ],
    },
  },
);
