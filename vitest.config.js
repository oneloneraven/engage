import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    passWithNoTests: true,
    coverage: { provider: "v8", reporter: ["text", "json-summary"] },
  },
});
