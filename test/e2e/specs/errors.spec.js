import { test, expect } from "@playwright/test";

test("syntax error turns the parse chip red and shows stderr", async ({ page }) => {
  await page.goto("/");
  // fill は pointer-events を要求しない(click は使わないこと — 非編集時の
  // textarea は pointer-events:none で actionability チェックに失敗する)
  await page.locator("#ruby-input").fill("def broken(\n  end");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="parse"]')).toHaveAttribute("data-state", "fail", { timeout: 30_000 });
  await expect(page.locator("#pane-ast .err-text")).toBeVisible();
  await expect(page.locator("#pane-c .pane-body")).toHaveClass(/stale/);
});

test("infinite loop reports a run timeout", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.locator("#ruby-input").fill("while true\nend\nputs 1");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="run"]')).toHaveAttribute("data-state", "fail", { timeout: 90_000 });
  await expect(page.locator("#pane-output .pane-body")).toContainText("タイムアウト");
});

test("a cc failure shows compiler stderr in the output pane", async ({ page }) => {
  await page.route("**/api/compile_run", (route) =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ cc_exit: 1, cc_stderr: "user.c:1:1: error: mock cc failure", run_exit: -1, stdout: "", stderr: "", duration_ms: 5, timed_out: false }) }));
  await page.goto("/");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="cc"]')).toHaveAttribute("data-state", "fail", { timeout: 30_000 });
  await expect(page.locator('.stage-chip[data-stage="run"]')).toHaveAttribute("data-state", "idle");
  await expect(page.locator("#pane-output .err-text")).toContainText("mock cc failure");
});
