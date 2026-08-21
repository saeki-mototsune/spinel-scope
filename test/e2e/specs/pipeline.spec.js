import { test, expect } from "@playwright/test";

test("run compiles fib through the wasm stages", async ({ page }) => {
  await page.goto("/");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="parse"]')).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await expect(page.locator('.stage-chip[data-stage="analyze"]')).toHaveAttribute("data-state", "ok");
  await expect(page.locator('.stage-chip[data-stage="codegen"]')).toHaveAttribute("data-state", "ok");
  await expect(page.locator("#pane-ast .pane-body")).toContainText("DefNode");
  await expect(page.locator("#pane-ir .pane-body")).toContainText("fib");
  await expect(page.locator("#pane-c .pane-body")).toContainText("sp_fib");
});

test("a missing wasm module fails the parse stage instead of hanging", async ({ page }) => {
  await page.route("**/wasm/spinel_parse.mjs", (route) => route.abort());
  await page.goto("/");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="parse"]')).toHaveAttribute("data-state", "fail", { timeout: 15_000 });
  await expect(page.locator("#pane-ast .err-text")).toBeVisible();
});

test("full run shows program output from the server", async ({ page }) => {
  await page.goto("/");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="run"]')).toHaveAttribute("data-state", "ok", { timeout: 45_000 });
  await expect(page.locator("#pane-output .pane-body")).toContainText("6765");
  await expect(page.locator("#pane-output .pane-body")).toContainText("exit 0");
});
