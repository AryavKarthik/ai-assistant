import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
  },
  resolve: { alias: { "@shared": new URL("./shared", import.meta.url).pathname } },
});
