import { test, expect } from '@playwright/test';
import { launchPage, waitForBoard, createProject } from './helpers';
import type { Browser, Page } from '@playwright/test';

const PROJECT_NAME = `BranchPicker Test ${Date.now()}`;
let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  const result = await launchPage();
  browser = result.browser;
  page = result.page;
  await createProject(page, PROJECT_NAME);
});

test.afterAll(async () => {
  await browser?.close();
});

/** Open the New Task dialog in the Backlog column */
async function openNewTaskDialog() {
  const column = page.locator('[data-swimlane-name="Backlog"]');
  const addButton = column.locator('text=+ Add task');
  await addButton.click();
  await page.locator('input[placeholder="Task title"]').waitFor({ state: 'visible' });
}

/** Close dialog by pressing Escape */
async function closeDialog() {
  await page.keyboard.press('Escape');
  await page.locator('input[placeholder="Task title"]').waitFor({ state: 'hidden', timeout: 2000 });
}

test.describe('BranchPicker', () => {
  test('chip renders with default branch name', async () => {
    await openNewTaskDialog();

    const chip = page.locator('[data-testid="branch-picker-chip"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('main');

    await closeDialog();
  });

  test('clicking chip opens dropdown with branch list', async () => {
    await openNewTaskDialog();

    const chip = page.locator('[data-testid="branch-picker-chip"]');
    await chip.click();

    // Wait for the dropdown to appear with the search input
    const searchInput = page.locator('input[placeholder="Search branches..."]');
    await expect(searchInput).toBeVisible();

    // Verify branches from mock are listed
    await expect(page.locator('button:has-text("develop")')).toBeVisible();
    await expect(page.locator('button:has-text("feature/auth")')).toBeVisible();

    // Close dropdown first (Escape closes dropdown, not dialog)
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible();

    await closeDialog();
  });

  test('selecting a branch closes dropdown and updates chip', async () => {
    await openNewTaskDialog();

    const chip = page.locator('[data-testid="branch-picker-chip"]');
    await chip.click();

    // Wait for branches to load
    const developBtn = page.locator('button:has-text("develop")');
    await developBtn.waitFor({ state: 'visible' });
    await developBtn.click();

    // Dropdown should close
    await expect(page.locator('input[placeholder="Search branches..."]')).not.toBeVisible();

    // Chip should now show the selected branch
    await expect(chip).toContainText('develop');

    await closeDialog();
  });

  test('Escape closes dropdown without closing parent dialog', async () => {
    await openNewTaskDialog();

    const chip = page.locator('[data-testid="branch-picker-chip"]');
    await chip.click();

    // Dropdown is open
    await expect(page.locator('input[placeholder="Search branches..."]')).toBeVisible();

    // Press Escape -- should close dropdown only
    await page.keyboard.press('Escape');
    await expect(page.locator('input[placeholder="Search branches..."]')).not.toBeVisible();

    // Parent dialog should still be open
    await expect(page.locator('input[placeholder="Task title"]')).toBeVisible();

    await closeDialog();
  });
});
