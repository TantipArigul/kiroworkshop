import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['dist/**', 'src/generated/**', 'node_modules/**'],
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
    // Integration tests spawn fake Nextflow/Docker processes and wait for worker passes; under
    // the parallel suite the 5 s default is too tight. Individual tests still set tighter waits.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
