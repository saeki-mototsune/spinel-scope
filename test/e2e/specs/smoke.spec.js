import { test, expect } from "@playwright/test";

test("page renders the five panes and stage bar", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#pane-ruby")).toBeVisible();
  await expect(page.locator("#pane-ast")).toBeVisible();
  await expect(page.locator("#pane-types")).toBeVisible();
  await expect(page.locator("#pane-c")).toBeVisible();
  await expect(page.locator("#pane-output")).toBeVisible();
  // parse → analyze + codegen (one spinel process) → cc → run
  await expect(page.locator(".stage-chip")).toHaveCount(4);
});

test("sample selector loads fib into the editor", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#ruby-input")).toHaveValue(/def fib/);
});
