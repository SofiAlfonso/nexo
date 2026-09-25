import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/central-core/web/**'],
    environment: 'node',
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/central-core/web/**'],
    },
  },
});
