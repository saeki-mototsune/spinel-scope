require_relative "app"
require_relative "rate_limiter"
# RATE_LIMIT overrides the per-IP compile_run budget (production default:
# 10/min, window unchanged at 60s). The E2E suite raises it via env var
# (see test/e2e/playwright.config.js) since its tests now issue enough
# real compile_run calls to sit at the production ceiling.
use RateLimiter, limit: Integer(ENV.fetch("RATE_LIMIT", "10"), 10),
                 trust_proxy: ENV["TRUST_PROXY"] == "1"
run SpinelVisualize::App
