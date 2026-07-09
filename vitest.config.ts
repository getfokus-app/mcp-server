import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    exclude: process.env.FOKUS_E2E ? [] : ['tests/integration/**'],
  },
});
