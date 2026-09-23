import { defineConfig } from "vitest/config";

/** Opt-in only: `npm run test:smoke`, never part of `npm test`/CI's default
 * gate. Runs the *.smoke.test.ts files that hit real external services. */
export default defineConfig({
  test: {
    include: ["src/**/*.smoke.test.ts"],
  },
});
