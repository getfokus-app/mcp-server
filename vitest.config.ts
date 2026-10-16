import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.spec.ts'],
    exclude: process.env.FOKUS_E2E ? [] : ['tests/integration/**'],
  },
});
