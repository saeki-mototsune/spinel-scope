import { test, expect } from "@playwright/test";

async function runFib(page) {
  await page.goto("/");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="codegen"]')).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
}

test("AST pane shows a collapsible tree with node ids", async ({ page }) => {
  await runFib(page);
  await expect(page.locator('#pane-ast .ast-node[data-node-id="2"]')).toContainText("DefNode");
  await expect(page.locator('#pane-ast .ast-node[data-node-id="2"]')).toContainText("fib");
});

test("AST pane toggles to raw text and back", async ({ page }) => {
  await runFib(page);
  await page.click("#pane-ast .pane-toggle");
  await expect(page.locator("#pane-ast .pane-body")).toContainText("N 2 DefNode");
  await page.click("#pane-ast .pane-toggle");
  await expect(page.locator('#pane-ast .ast-node[data-node-id="0"]')).toBeVisible();
});

test("IR pane shows the inferred method table", async ({ page }) => {
  await runFib(page);
  await expect(page.locator('#pane-ir .ir-method[data-method-key="fib"]')).toContainText("fib(n: int) → int");
});

test("IR pane raw toggle shows SPINEL-IR text", async ({ page }) => {
  await runFib(page);
  await page.click("#pane-ir .pane-toggle");
  await expect(page.locator("#pane-ir .pane-body")).toContainText("SPINEL-IR v1");
});

test("switching samples clears stale highlights", async ({ page }) => {
  await page.goto("/");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="codegen"]')).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await page.selectOption("#sample-select", "class_ivar.rb");
  // old index gone: hovering an AST node must not highlight anything (pane now stale/empty of live index)
  await expect(page.locator("#pane-ast .pane-body")).toHaveClass(/stale/);
});

test("IR pane hides compiler-internal classes but keeps user-defined ones", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sample-select", "class_ivar.rb");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="codegen"]')).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await expect(page.locator("#pane-ir .ir-class")).toHaveCount(1);
  await expect(page.locator("#pane-ir .ir-class")).toContainText("class Counter:");
  await expect(page.locator("#pane-ir .pane-body")).not.toContainText("class Method:");
});

test("double-clicking a pane head collapses the column", async ({ page }) => {
  await page.goto("/");
  await page.dblclick("#pane-ir .pane-head");
  await expect(page.locator("#pane-ir")).toHaveClass(/collapsed/);
  await expect(page.locator("#pane-ir .pane-body")).toBeHidden();
  await page.dblclick("#pane-ir .pane-head");
  await expect(page.locator("#pane-ir")).not.toHaveClass(/collapsed/);
});
