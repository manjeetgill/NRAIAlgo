import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// Vitest (unlike Jest) doesn't auto-register Testing Library's DOM
// cleanup -- without this, each test's rendered output piles up in the
// same document instead of unmounting, so queries like getByText start
// matching duplicates across tests.
afterEach(() => {
  cleanup();
});
