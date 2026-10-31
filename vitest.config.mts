import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Next resolves this marker at build time; tests run server code directly.
      "server-only": fileURLToPath(new URL("./src/server/testing/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Live tests hit a real Supabase project; run them with `npm run test:live`.
    exclude: ["src/**/*.live.test.ts", "node_modules/**"],
    environment: "node",
  },
});
