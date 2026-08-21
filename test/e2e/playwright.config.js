import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  timeout: 60_000,
  workers: 1, // compile_run tests share the API rate limiter; serialize for determinism (E2E server runs with RATE_LIMIT=100)
  use: { baseURL: "http://localhost:9292" },
  webServer: {
    // RATE_LIMIT raises the per-IP compile_run budget (server/config.ru,
    // default 10/min) so the suite's real compile_run calls — now 10 with
    // nonascii.spec.js added — have headroom above the production ceiling.
    command: "cd ../../server && RATE_LIMIT=100 bundle exec puma -p 9292",
    url: "http://localhost:9292/",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
