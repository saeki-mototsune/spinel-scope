import { test, expect } from "@playwright/test";

test("page renders the five panes and stage bar", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#pane-ruby")).toBeVisible();
  await expect(page.locator("#pane-ast")).toBeVisible();
  await expect(page.locator("#pane-ir")).toBeVisible();
  await expect(page.locator("#pane-c")).toBeVisible();
  await expect(page.locator("#pane-output")).toBeVisible();
  await expect(page.locator(".stage-chip")).toHaveCount(5);
});

test("sample selector loads fib into the editor", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#ruby-input")).toHaveValue(/def fib/);
});
