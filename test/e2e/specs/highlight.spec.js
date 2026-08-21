import { test, expect } from "@playwright/test";

async function runFib(page) {
  await page.goto("/");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="codegen"]')).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
}

// The codegen stage (parse/analyze/codegen) is pure client-side wasm, but
// main.js unconditionally fires a real POST /api/compile_run right after —
// even for tests that, like the two below, only assert on client-side
// panes and never look at the cc/run stage outcome. The server's rate
// limiter is a shared per-IP budget (10 req/min, see
// server/rate_limiter.rb and the note in playwright.config.js) that the
// whole suite's real runs must fit into; stubbing the response here for
// tests that don't need a real compile keeps this suite's addition from
// starving pipeline.spec.js's "full run" test of budget.
async function stubCompileRun(page) {
  await page.route("**/api/compile_run", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cc_exit: 0, cc_stderr: "", run_exit: 0, timed_out: false, duration_ms: 1, stdout: "", stderr: "" }),
    }),
  );
}

test("hovering AST node highlights the Ruby range", async ({ page }) => {
  await runFib(page);
  await page.hover('#pane-ast .ast-node[data-node-id="7"]'); // CallNode "<"
  // The overlay highlights one <span data-ci> per character, so the range
  // "n < 2" resolves to 5 separate .hl elements — a scalar toHaveText()
  // regex hits Playwright's strict-mode "resolved to N elements" error.
  // Join their text content instead of asserting on a single-element locator.
  const text = (await page.locator("#ruby-overlay .hl").allTextContents()).join("");
  expect(text).toMatch(/n < 2/);
});

test("hovering Ruby source highlights AST node and shows type tooltip", async ({ page }) => {
  await runFib(page);
  const target = page.locator('#ruby-overlay span[data-ci="20"]'); // 「n < 2」内の1文字
  await target.hover();
  await expect(page.locator('#pane-ast .ast-node.hl')).toHaveCount(1, { timeout: 5_000 });
  await expect(page.locator("#hover-tooltip")).toBeVisible();
  await expect(page.locator("#hover-tooltip")).toContainText(/bool|int/);
});

test("sugar-rewritten source disables ruby-pane highlighting with a notice", async ({ page }) => {
  await page.goto("/");
  await page.locator("#ruby-input").fill('puts [1, 2, 3].map(&:to_s).join(",")');
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="codegen"]')).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await expect(page.locator("#pane-ruby .map-notice")).toBeVisible();
  const anyAst = page.locator("#pane-ast .ast-node").first();
  await anyAst.hover();
  await expect(page.locator("#ruby-overlay .hl")).toHaveCount(0);
});

test("typing re-renders the overlay live", async ({ page }) => {
  await page.goto("/");
  await page.locator("#ruby-input").fill("puts 1");
  await expect(page.locator("#ruby-overlay")).toContainText("puts 1");
  // .fill() already focuses #ruby-input (verified: it gains .editing right
  // after fill(), which sets pointer-events:auto and puts it above the
  // overlay per the editing/hover mutual-exclusion contract). Clicking
  // #ruby-overlay here to "re-focus" would itself be intercepted by that
  // same now-focused, now-topmost textarea, so it's both redundant and
  // unreachable — type directly into the already-focused textarea instead.
  await page.keyboard.type("23");
  await expect(page.locator("#ruby-overlay")).toContainText("23");
});

test("hovering the C function highlights the Ruby method", async ({ page }) => {
  await stubCompileRun(page);
  await runFib(page);
  await page.hover('#pane-c .c-line.c-method[data-method-key="fib"]');
  // Same multi-span caveat as the AST-hover test above: the DefNode's ruby
  // range covers the whole "def fib...end" body, so #ruby-overlay .hl
  // resolves to one <span> per character — join instead of a scalar match.
  const text = (await page.locator("#ruby-overlay .hl").allTextContents()).join("");
  expect(text).toMatch(/def fib/);
  await expect(page.locator('#pane-ir .ir-method.hl[data-method-key="fib"]')).toHaveCount(1);
});

test("editing the source marks downstream panes stale", async ({ page }) => {
  await stubCompileRun(page);
  await runFib(page);
  // textarea は非編集時 pointer-events:none のため、クリックはオーバーレイへ
  // (オーバーレイの click ハンドラが textarea に focus を委譲する)
  await page.locator("#ruby-overlay").click();
  await page.keyboard.type("# comment");
  await expect(page.locator("#pane-ast .pane-body")).toHaveClass(/stale/);
  await expect(page.locator("#pane-c .pane-body")).toHaveClass(/stale/);
});
