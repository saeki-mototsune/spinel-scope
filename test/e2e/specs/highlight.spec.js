import { test, expect } from "@playwright/test";

async function runFib(page) {
  await page.goto("/");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="compile"]')).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
}

// The compile stage (parse/analyze/codegen) is pure client-side wasm, but
// main.js unconditionally fires a real POST /api/compile_run right after —
// even for tests that, like most below, only assert on client-side panes
// and never look at the cc/run stage outcome. The server's rate limiter is a
// shared per-IP budget (10 req/min, see server/rate_limiter.rb and the note
// in playwright.config.js) that the whole suite's real runs must fit into;
// stubbing the response here for tests that don't need a real compile keeps
// this suite from starving pipeline.spec.js's "full run" test of budget.
async function stubCompileRun(page) {
  await page.route("**/api/compile_run", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cc_exit: 0, cc_stderr: "", run_exit: 0, timed_out: false, duration_ms: 1, stdout: "", stderr: "" }),
    }),
  );
}

// The overlay highlights one <span data-ci> per character, so a range
// resolves to several .hl elements — a scalar toHaveText() hits
// Playwright's strict-mode "resolved to N elements" error. Join their text.
const rubyHighlight = async (page) => (await page.locator("#ruby-overlay .hl").allTextContents()).join("");

test.beforeEach(async ({ page }) => { await stubCompileRun(page); });

test("hovering AST node highlights the Ruby range", async ({ page }) => {
  await runFib(page);
  await page.hover('#pane-ast .ast-node[data-node-id="7"]'); // CallNode "<"
  expect(await rubyHighlight(page)).toBe("n < 2");
});

test("hovering Ruby source highlights AST node, C line and shows type tooltip", async ({ page }) => {
  await runFib(page);
  await page.locator('#ruby-overlay span[data-ci="18"]').hover(); // 「n < 2」の「<」
  await expect(page.locator("#pane-ast .ast-node.hl")).toHaveCount(1, { timeout: 5_000 });
  await expect(page.locator("#hover-tooltip")).toBeVisible();
  await expect(page.locator("#hover-tooltip")).toContainText("bool");
  // #line 2 "main.rb" → the C of that Ruby line
  await expect(page.locator("#pane-c .c-line.hl")).toContainText(["lv_n < 2"]);
});

test("hovering a C statement highlights the Ruby line it came from", async ({ page }) => {
  await runFib(page);
  await page.locator("#pane-c .c-line", { hasText: "lv_n < 2" }).hover();
  expect(await rubyHighlight(page)).toBe("  if n < 2");
});

test("hovering the C function header highlights the Ruby method", async ({ page }) => {
  await runFib(page);
  await page.hover('#pane-c .c-line.c-method[data-method-key="fib"]');
  expect(await rubyHighlight(page)).toMatch(/^def fib/);
  await expect(page.locator('#pane-types .ty-method.hl[data-method-key="fib"]')).toHaveCount(1);
});

test("hovering a codegen decision highlights its call", async ({ page }) => {
  await runFib(page);
  await page.locator("#pane-types .ty-call", { hasText: "L9:6 fib" }).hover();
  expect(await rubyHighlight(page)).toBe("fib(20)");
});

// spinel rewrites `&:sym` in the source text before parsing, so positions on
// that line describe other text: that line (only) goes unmapped.
test("a line spinel rewrote is left unmapped, the rest still maps", async ({ page }) => {
  await page.goto("/");
  await page.locator("#ruby-input").fill('x = 1\nputs [1, 2, 3].map(&:to_s).join(",")\nputs x');
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="compile"]')).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await expect(page.locator("#pane-ruby .map-notice")).toBeVisible();
  await expect(page.locator("#pane-ruby .map-notice")).toContainText("2 行目");
  await page.locator("#pane-ast .ast-node", { hasText: 'CallNode "map"' }).hover();
  await expect(page.locator("#ruby-overlay .hl")).toHaveCount(0);
  await page.locator("#pane-ast .ast-node", { hasText: 'LocalVariableWriteNode "x"' }).hover();
  expect(await rubyHighlight(page)).toBe("x = 1");
});

// Regression for patches/0001: with builtins spliced ahead of the program,
// positions must still land on the right lines.
test("class_ivar positions survive the spliced builtins", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sample-select", "class_ivar.rb");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="compile"]')).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await page.hover('#pane-types .ty-method[data-method-key="Counter#increment"]');
  expect(await rubyHighlight(page)).toMatch(/^def increment\s+@count \+= 1\s+end$/);
  await expect(page.locator("#pane-c .c-line.c-method.hl")).toContainText("sp_Counter_increment");
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

test("editing the source marks downstream panes stale", async ({ page }) => {
  await runFib(page);
  // textarea は非編集時 pointer-events:none のため、クリックはオーバーレイへ
  // (オーバーレイの click ハンドラが textarea に focus を委譲する)
  await page.locator("#ruby-overlay").click();
  await page.keyboard.type("# comment");
  await expect(page.locator("#pane-ast .pane-body")).toHaveClass(/stale/);
  await expect(page.locator("#pane-c .pane-body")).toHaveClass(/stale/);
});
