import { test, expect } from '@playwright/test';
import { launchPage, createProject, createTask } from './helpers';
import type { Browser, Page } from '@playwright/test';

const PROJECT_NAME = `PR URL Test ${Date.now()}`;
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

/** Locate a task card by title within the board swimlanes */
function taskCard(title: string) {
  return page.locator('[data-testid="swimlane"]').locator(`text=${title}`).first();
}

test.describe('PR URL in Edit Form', () => {
  test('PR URL field is hidden in To Do column', async () => {
    await createTask(page, 'PR URL Test Task');
    await taskCard('PR URL Test Task').click();
    await page.locator('input[placeholder="Task title"]').waitFor({ state: 'visible' });

    const prUrlInput = page.locator('[data-testid="pr-url-input"]');
    await expect(prUrlInput).not.toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('saving PR URL persists and shows PR badge on card', async () => {
    // Move task to Planning via context menu
    await taskCard('PR URL Test Task').click({ button: 'right' });
    await page.locator('[data-testid="context-move-to"]', { hasText: 'Planning' }).click();

    // Open task in Planning
    const planning = page.locator('[data-swimlane-name="Planning"]');
    await planning.locator('text=PR URL Test Task').first().click();
    await page.locator('input[placeholder="Task title"]').waitFor({ state: 'visible' });

    const prUrlInput = page.locator('[data-testid="pr-url-input"]');
    await expect(prUrlInput).toBeVisible();
    await prUrlInput.fill('https://github.com/owner/repo/pull/99');
    await page.locator('button:has-text("Save")').click();

    // Card should now show PR badge
    const prBadge = planning.locator('[data-testid="task-card-pr-link"]');
    await expect(prBadge).toBeVisible({ timeout: 3000 });
    await expect(prBadge).toHaveText('PR #99');
  });

  test('clearing PR URL removes badge from card', async () => {
    const planning = page.locator('[data-swimlane-name="Planning"]');
    await planning.locator('text=PR URL Test Task').first().click();
    await page.locator('input[placeholder="Task title"]').waitFor({ state: 'visible' });

    const prUrlInput = page.locator('[data-testid="pr-url-input"]');
    await expect(prUrlInput).toHaveValue('https://github.com/owner/repo/pull/99');
    await prUrlInput.clear();
    await page.locator('button:has-text("Save")').click();

    // PR badge on card should be gone
    await expect(planning.locator('[data-testid="task-card-pr-link"]')).not.toBeVisible({ timeout: 3000 });
  });
});
