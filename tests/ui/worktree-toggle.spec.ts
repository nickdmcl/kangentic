import { test, expect } from '@playwright/test';
import { launchPage, waitForBoard, createProject, createTask } from './helpers';
import type { Browser, Page } from '@playwright/test';

const PROJECT_NAME = `WorktreeToggle Test ${Date.now()}`;
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

test.describe('Worktree Toggle', () => {
  test('toggle is visible in New Task dialog', async () => {
    await openNewTaskDialog();

    const toggle = page.locator('[data-testid="worktree-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('Worktree');

    await closeDialog();
  });

  test('toggle defaults to enabled when global worktrees setting is ON', async () => {
    await openNewTaskDialog();

    const toggle = page.locator('[data-testid="worktree-toggle"]');
    // Default config has worktreesEnabled: true — chip should NOT have line-through
    const span = toggle.locator('span');
    await expect(span).not.toHaveClass(/line-through/);

    await closeDialog();
  });

  test('clicking toggle switches to disabled state', async () => {
    await openNewTaskDialog();

    const toggle = page.locator('[data-testid="worktree-toggle"]');
    await toggle.click();

    // After toggling off, the span should have line-through styling
    const span = toggle.locator('span');
    await expect(span).toHaveClass(/line-through/);

    await closeDialog();
  });

  test('clicking toggle twice returns to enabled state', async () => {
    await openNewTaskDialog();

    const toggle = page.locator('[data-testid="worktree-toggle"]');
    // Toggle off
    await toggle.click();
    const span = toggle.locator('span');
    await expect(span).toHaveClass(/line-through/);

    // Toggle back on
    await toggle.click();
    await expect(span).not.toHaveClass(/line-through/);

    await closeDialog();
  });

  test('created task receives use_worktree: 0 when toggled off', async () => {
    await openNewTaskDialog();

    // Fill in title
    await page.locator('input[placeholder="Task title"]').fill('Worktree Off Task');

    // Toggle worktree off
    const toggle = page.locator('[data-testid="worktree-toggle"]');
    await toggle.click();

    // Create the task
    await page.locator('button:has-text("Create")').click();
    await page.waitForTimeout(300);

    // Verify the task was created with use_worktree = 0
    const taskData = await page.evaluate(() => {
      return window.electronAPI.tasks.list();
    });
    const task = taskData.find((t: { title: string }) => t.title === 'Worktree Off Task');
    expect(task).toBeDefined();
    expect(task.use_worktree).toBe(0);
  });

  test('created task has use_worktree: null when not toggled', async () => {
    await openNewTaskDialog();

    // Fill in title without touching the toggle
    await page.locator('input[placeholder="Task title"]').fill('Default Worktree Task');

    // Create the task
    await page.locator('button:has-text("Create")').click();
    await page.waitForTimeout(300);

    // Verify the task was created with use_worktree = null (follows global)
    const taskData = await page.evaluate(() => {
      return window.electronAPI.tasks.list();
    });
    const task = taskData.find((t: { title: string }) => t.title === 'Default Worktree Task');
    expect(task).toBeDefined();
    expect(task.use_worktree).toBeNull();
  });

  test('task detail edit mode shows toggle for pre-session task', async () => {
    // Create a task first
    await createTask(page, 'Detail Toggle Task');

    // Click on the task card to open detail dialog
    // Backlog tasks open directly in edit mode
    const taskCard = page.locator('text=Detail Toggle Task').first();
    await taskCard.click();
    await page.locator('[data-testid="task-detail-dialog"]').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);

    // Worktree toggle should be visible in edit mode (no session = pre-session)
    const toggle = page.locator('[data-testid="worktree-toggle"]');
    await expect(toggle).toBeVisible();

    // Close by pressing Escape
    await page.keyboard.press('Escape');
  });
});
