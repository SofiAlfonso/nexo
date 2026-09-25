import { defineConfig } from 'vitest/config';

// Pruebas con Docker (Testcontainers): npm run test:integration
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
