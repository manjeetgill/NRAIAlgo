import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // *.smoke.test.ts hits real external services (NSE's live archive, and
    // would hit real broker endpoints if real credentials were supplied) --
    // excluded from the normal suite so `npm test` never depends on network
    // access or third-party uptime. Run them explicitly with `npm run test:smoke`.
    exclude: ["**/node_modules/**", "src/**/*.smoke.test.ts"],
  },
});
