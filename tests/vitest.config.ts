import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../", import.meta.url));
export default defineConfig({
  root,
  test: {
    projects: [
      { root, test: { name: "api", include: ["tests/api/**/*.test.ts"], exclude: ["**/*.smoke.test.ts"], setupFiles: ["tests/api/setup.ts"], fileParallelism: false } },
      { root, test: { name: "contracts", include: ["tests/contracts/**/*.test.ts"] } },
      {
        root,
        plugins: [react()],
        resolve: { alias: { "@": fileURLToPath(new URL("../apps/web", import.meta.url)) } },
        test: { name: "web", environment: "jsdom", include: ["tests/web/**/*.test.{ts,tsx}"], setupFiles: ["tests/web/setup.ts"] },
      },
      { root, test: { name: "smoke", include: ["tests/api/**/*.smoke.test.ts"] } },
    ],
  },
});
