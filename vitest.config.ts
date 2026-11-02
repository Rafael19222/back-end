import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false, // les tests HTTP partagent une même base de test
    testTimeout: 15000,
  },
});
