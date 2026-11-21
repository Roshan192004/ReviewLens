import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run tests in Node environment (no browser simulation needed)
    environment: "node",
    // Look for tests only in the tests/ directory
    include: ["tests/**/*.test.js"],
  },
});

