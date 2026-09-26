import { test, expect } from "@playwright/test";

test("non-ascii source keeps highlights aligned", async ({ page }) => {
  await page.goto("/");
  await page.selectOption("#sample-select", "nihongo.rb");
  await page.click("#run-btn");
  await expect(page.locator('.stage-chip[data-stage="run"]')).toHaveAttribute("data-state", "ok", { timeout: 45_000 });
  await expect(page.locator("#pane-output .pane-body")).toContainText("こんにちは、spinel!");
  // greeting = "こんにちは" の StringNode をホバー → Ruby 側で正確な範囲が光る
  const strNode = page.locator("#pane-ast .ast-node", { hasText: "StringNode" }).first();
  await strNode.hover();
  // The overlay highlights one .hl span per character (see highlight.js
  // highlightRange), so a multi-char range resolves to several elements —
  // a scalar toHaveText() on a multi-element locator hits Playwright's
  // strict-mode "resolved to N elements" error (same caveat documented in
  // highlight.spec.js). Join their text content instead.
  const text = (await page.locator("#ruby-overlay .hl").allTextContents()).join("");
  expect(text).toMatch(/こんにちは/);
});
