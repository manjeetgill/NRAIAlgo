import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the "@/*" alias from tsconfig.json so it works identically
  // in tests and in the Next.js build -- without it, a test importing
  // "@/..." would fail even though `next build` resolves the same
  // import fine.
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.tsx", "**/*.test.ts"],
  },
});
