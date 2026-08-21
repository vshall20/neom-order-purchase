import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Pure domain logic. No emulator, no network.
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        // Security rules. Requires the Firestore emulator; run via
        // `npm run test:rules`, which starts it for the duration.
        test: {
          name: 'rules',
          environment: 'node',
          include: ['tests/rules/**/*.test.ts'],
          testTimeout: 20_000,
          hookTimeout: 30_000,
          // Every rules test file clears the emulator database in beforeEach,
          // so two files running at once wipe each other's seeded profiles.
          // `npm run test:rules` passes --no-file-parallelism for this reason.
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
