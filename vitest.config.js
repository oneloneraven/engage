import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The Workers pool can't read the filesystem, so migrations go in as a binding.
const migrations = await readD1Migrations("./migrations");

const NODE_TESTS = ["test/lib/**/*.test.js", "test/scripts/**/*.test.js", "test/wrangler-previews.test.js"];

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: { provider: "v8", reporter: ["text", "json-summary"] },
    projects: [
      {
        test: {
          name: "workers",
          include: ["test/**/*.test.js"],
          exclude: NODE_TESTS,
          setupFiles: ["./test/apply-migrations.js"],
        },
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              // Tests never reach a real service: one that wants a reply stubs fetch, and anything else lands here.
              outboundService: request =>
                new Response(`Tests can't reach ${new URL(request.url).hostname}`, { status: 599 }),
              bindings: {
                TEST_D1_MIGRATIONS: migrations,
                ADMIN_HOST: "engage.oneloneraven.com",
                PUBLIC_HOST: "engage-api.oneloneraven.com",
              },
            },
          }),
        ],
      },
      {
        test: { name: "node", include: NODE_TESTS, environment: "node" },
      },
    ],
  },
});
