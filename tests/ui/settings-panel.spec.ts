import { test, expect } from '@playwright/test';
import { launchPage, waitForBoard, createProject } from './helpers';
import type { Browser, Page } from '@playwright/test';

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  const result = await launchPage();
  browser = result.browser;
  page = result.page;
  await createProject(page, `Settings Test ${Date.now()}`);
});

test.afterAll(async () => {
  await browser?.close();
});

/** Open the settings panel by clicking the gear button in the title bar. */
async function openSettings() {
  await page.locator('button[title="Settings"]').click();
  await page.waitForTimeout(300);
}

/** Close the settings panel if open. */
async function closeSettings() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

test.describe('Settings Panel', () => {
  test('settings button opens panel', async () => {
    await openSettings();
    await expect(page.locator('h2:has-text("Settings")')).toBeVisible();
    await closeSettings();
  });

  test('settings panel has all 5 tabs', async () => {
    await openSettings();
    await expect(page.locator('button:has-text("Appearance")')).toBeVisible();
    await expect(page.locator('button:has-text("Terminal")')).toBeVisible();
    await expect(page.locator('button:has-text("Agent")')).toBeVisible();
    await expect(page.locator('button:has-text("Git")')).toBeVisible();
    await expect(page.locator('button:has-text("Behavior")')).toBeVisible();
    await closeSettings();
  });

  test('tab navigation switches content', async () => {
    await openSettings();

    // Appearance tab is default -- Theme setting visible
    await expect(page.locator('text=Theme')).toBeVisible();

    // Switch to Terminal -- Font Size visible
    await page.locator('button:has-text("Terminal")').click();
    await expect(page.locator('text=Font Size')).toBeVisible();

    // Switch to Agent -- Permissions visible
    await page.locator('button:has-text("Agent")').click();
    await expect(page.getByText('Permissions', { exact: true })).toBeVisible();

    // Switch to Git -- Enable Worktrees visible
    await page.locator('button:has-text("Git")').click();
    await expect(page.locator('text=Enable Worktrees')).toBeVisible();

    // Switch to Behavior -- Skip Task Delete visible
    await page.locator('button:has-text("Behavior")').click();
    await expect(page.locator('text=Skip Task Delete Confirmation')).toBeVisible();

    await closeSettings();
  });

  test('permission strategy dropdown has correct options (no Plan)', async () => {
    await openSettings();
    await page.locator('button:has-text("Agent")').click();

    const select = page.locator('.overflow-y-auto select').first();
    const options = select.locator('option');
    const texts = await options.allTextContents();

    expect(texts).toContain('Default (Allowlist)');
    expect(texts).toContain('Accept Edits');
    expect(texts).toContain('Bypass (Unsafe)');
    expect(texts).not.toContain('Manual Approval');
    expect(texts).not.toContain('Plan');
    // Verify old labels and legacy internal values are gone
    expect(texts.join()).not.toContain('Project Settings');
    expect(texts.join()).not.toContain('Skip Permissions');
    expect(texts.join()).not.toContain('project-settings');
    expect(texts.join()).not.toContain('dangerously-skip');

    await closeSettings();
  });

  test('board remains visible behind settings panel', async () => {
    await openSettings();
    // The board swimlanes should still be in the DOM (panel is an overlay, not a replacement)
    await expect(page.locator('[data-swimlane-name="Backlog"]')).toBeAttached();
    await expect(page.locator('[data-swimlane-name="Planning"]')).toBeAttached();
    await closeSettings();
  });

  test('Escape key closes panel', async () => {
    await openSettings();
    const header = page.locator('h2:has-text("Settings")');
    await expect(header).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(header).not.toBeVisible({ timeout: 2000 });
  });

  test('settings gear shows active state when panel is open', async () => {
    const gearButton = page.locator('button[title="Settings"]');

    // Open and verify active styling
    await gearButton.click();
    await page.waitForTimeout(300);
    await expect(gearButton).toHaveClass(/bg-surface-hover/);

    await closeSettings();
  });

  test('CLI path status indicator appears after panel opens', async () => {
    await openSettings();
    await page.locator('button:has-text("Agent")').click();

    // The mock returns { found: false }, so the indicator div has title="Claude CLI not found"
    await expect(page.locator('[title="Claude CLI not found"]')).toBeVisible();

    await closeSettings();
  });
});
