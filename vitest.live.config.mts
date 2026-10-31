import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Minimal KEY=value reader for .env.local (no interpolation). */
function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

/**
 * Live integration tests against a real Supabase project and a running app.
 * Opt-in: `npm run test:live` (reads .env.local; needs LIVE_BASE_URL for HTTP tests).
 * Never point this at production: it creates and deletes test users.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/server/testing/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.live.test.ts"],
    environment: "node",
    env: { ...readEnvFile(".env.local"), ...process.env } as Record<string, string>,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
