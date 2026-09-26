import { test, expect } from "@playwright/test";

async function run(page, sample) {
  await page.goto("/");
  if (sample) await page.selectOption("#sample-select", sample);
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="compile"]')).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
}

test("AST pane shows a collapsible tree with node ids", async ({ page }) => {
  await run(page);
  await expect(page.locator('#pane-ast .ast-node[data-node-id="2"]')).toContainText("DefNode");
  await expect(page.locator('#pane-ast .ast-node[data-node-id="2"]')).toContainText("fib");
});

test("AST pane toggles to raw text and back", async ({ page }) => {
  await run(page);
  await page.click("#pane-ast .pane-toggle");
  await expect(page.locator("#pane-ast .pane-body")).toContainText("N 2 DefNode");
  await page.click("#pane-ast .pane-toggle");
  await expect(page.locator('#pane-ast .ast-node[data-node-id="0"]')).toBeVisible();
});

test("AST pane folds the spliced builtins away", async ({ page }) => {
  await run(page, "class_ivar.rb");
  // 3.times { } splices builtins/enumerator.rb and builtins/enumerable.rb
  await expect(page.locator("#pane-ast .ast-spliced")).toHaveCount(2);
  await expect(page.locator("#pane-ast .ast-spliced").first()).toContainText("builtins/");
});

test("types pane shows the method signatures", async ({ page }) => {
  await run(page);
  await expect(page.locator('#pane-types .ty-method[data-method-key="fib"]')).toContainText("def fib: (Integer) -> Integer");
});

test("types pane raw toggle shows the --emit-types JSON", async ({ page }) => {
  await run(page);
  await page.click("#pane-types .pane-toggle");
  await expect(page.locator("#pane-types .pane-body")).toContainText('"signature":"(Integer) -> Integer"');
});

test("types pane shows the user's classes only", async ({ page }) => {
  await run(page, "class_ivar.rb");
  await expect(page.locator("#pane-types .ty-class")).toHaveCount(1);
  await expect(page.locator("#pane-types .ty-class")).toContainText("class Counter");
  await expect(page.locator("#pane-types .ty-class")).toContainText("@count: Integer");
  // the builtins' own methods and widening warnings stay out
  await expect(page.locator("#pane-types .pane-body")).not.toContainText("__enumw");
});

test("C pane hides #line directives until toggled", async ({ page }) => {
  await run(page);
  await expect(page.locator("#pane-c .pane-body")).not.toContainText('#line 2 "main.rb"');
  await page.click("#pane-c .pane-toggle");
  await expect(page.locator("#pane-c .pane-body")).toContainText('#line 2 "main.rb"');
});

test("switching samples clears stale highlights", async ({ page }) => {
  await run(page);
  await page.selectOption("#sample-select", "class_ivar.rb");
  await expect(page.locator("#pane-ast .pane-body")).toHaveClass(/stale/);
});

test("double-clicking a pane head collapses the column", async ({ page }) => {
  await page.goto("/");
  await page.dblclick("#pane-types .pane-head");
  await expect(page.locator("#pane-types")).toHaveClass(/collapsed/);
  await expect(page.locator("#pane-types .pane-body")).toBeHidden();
  await page.dblclick("#pane-types .pane-head");
  await expect(page.locator("#pane-types")).not.toHaveClass(/collapsed/);
});
