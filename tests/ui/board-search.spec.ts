import { test, expect } from '@playwright/test';
import { launchPage, waitForBoard, createProject, createTask } from './helpers';
import type { Browser, Page } from '@playwright/test';

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  const result = await launchPage();
  browser = result.browser;
  page = result.page;

  await createProject(page, `search-test-${Date.now()}`);
  await waitForBoard(page);

  // Create tasks with distinct titles and descriptions for filtering
  await createTask(page, 'Fix login bug', 'Authentication flow is broken');
  await createTask(page, 'Add dashboard widget', 'New chart component');
  await createTask(page, 'Update README', 'Documentation refresh');
});

test.afterAll(async () => {
  await browser?.close();
});

test.describe('Board Search', () => {
  test('search bar is visible on board load (default config)', async () => {
    await expect(page.locator('[data-testid="board-search-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="board-search-input"]')).toBeVisible();
  });

  test('typing filters tasks across columns', async () => {
    const searchInput = page.locator('[data-testid="board-search-input"]');
    await searchInput.fill('login');

    // The matching task should be visible
    await expect(page.locator('[data-testid="swimlane"]').locator('text=Fix login bug')).toBeVisible();

    // Non-matching tasks should be hidden
    await expect(page.locator('[data-testid="swimlane"]').locator('text=Add dashboard widget')).not.toBeVisible();
    await expect(page.locator('[data-testid="swimlane"]').locator('text=Update README')).not.toBeVisible();
  });

  test('match count shows correctly', async () => {
    const searchInput = page.locator('[data-testid="board-search-input"]');
    await searchInput.fill('login');

    const matchCount = page.locator('[data-testid="board-search-match-count"]');
    await expect(matchCount).toContainText('1 of 3');
  });

  test('search matches description text', async () => {
    const searchInput = page.locator('[data-testid="board-search-input"]');
    await searchInput.fill('chart');

    await expect(page.locator('[data-testid="swimlane"]').locator('text=Add dashboard widget')).toBeVisible();
    await expect(page.locator('[data-testid="swimlane"]').locator('text=Fix login bug')).not.toBeVisible();
  });

  test('Ctrl+F focuses the search input', async () => {
    // Click somewhere else first to unfocus
    await page.locator('[data-testid="board-search-bar"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+f');

    const searchInput = page.locator('[data-testid="board-search-input"]');
    await expect(searchInput).toBeFocused();
  });

  test('Escape clears query', async () => {
    const searchInput = page.locator('[data-testid="board-search-input"]');
    await searchInput.fill('login');

    await expect(page.locator('[data-testid="board-search-match-count"]')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(searchInput).toHaveValue('');
    // All tasks should be visible again
    await expect(page.locator('[data-testid="swimlane"]').locator('text=Fix login bug')).toBeVisible();
    await expect(page.locator('[data-testid="swimlane"]').locator('text=Add dashboard widget')).toBeVisible();
  });

  test('clear button (X) resets search', async () => {
    const searchInput = page.locator('[data-testid="board-search-input"]');
    await searchInput.fill('dashboard');

    const clearButton = page.locator('[data-testid="board-search-clear"]');
    await expect(clearButton).toBeVisible();
    await clearButton.click();

    await expect(searchInput).toHaveValue('');
    // All tasks should be visible
    await expect(page.locator('[data-testid="swimlane"]').locator('text=Fix login bug')).toBeVisible();
    await expect(page.locator('[data-testid="swimlane"]').locator('text=Add dashboard widget')).toBeVisible();
    await expect(page.locator('[data-testid="swimlane"]').locator('text=Update README')).toBeVisible();
  });

  test('empty query shows all tasks', async () => {
    const searchInput = page.locator('[data-testid="board-search-input"]');
    await searchInput.fill('');

    await expect(page.locator('[data-testid="swimlane"]').locator('text=Fix login bug')).toBeVisible();
    await expect(page.locator('[data-testid="swimlane"]').locator('text=Add dashboard widget')).toBeVisible();
    await expect(page.locator('[data-testid="swimlane"]').locator('text=Update README')).toBeVisible();
  });

  test('dismiss button hides bar and shows toast', async () => {
    const dismissButton = page.locator('[data-testid="board-search-dismiss"]');
    await dismissButton.click();

    await expect(page.locator('[data-testid="board-search-bar"]')).not.toBeVisible();

    // Toast should appear (text varies by platform: Ctrl+F or ⌘+F)
    await expect(page.locator('text=/Press .+\\+F to search/')).toBeVisible({ timeout: 3000 });
  });

  test('Ctrl+F re-shows bar after dismiss', async () => {
    // Bar should be hidden from previous test
    await expect(page.locator('[data-testid="board-search-bar"]')).not.toBeVisible();

    await page.keyboard.press('Control+f');

    await expect(page.locator('[data-testid="board-search-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="board-search-input"]')).toBeFocused();
  });

  test('Ctrl+F toggles bar off when query is empty', async () => {
    // Bar should be visible from previous test, query should be empty
    await expect(page.locator('[data-testid="board-search-bar"]')).toBeVisible();
    const searchInput = page.locator('[data-testid="board-search-input"]');
    await searchInput.fill('');

    await page.keyboard.press('Control+f');

    await expect(page.locator('[data-testid="board-search-bar"]')).not.toBeVisible();

    // Re-show for subsequent test hygiene
    await page.keyboard.press('Control+f');
    await expect(page.locator('[data-testid="board-search-bar"]')).toBeVisible();
  });

  test('Ctrl+F from focused input toggles bar off when query is empty', async () => {
    const searchInput = page.locator('[data-testid="board-search-input"]');
    await searchInput.click();
    await expect(searchInput).toBeFocused();
    await searchInput.fill('');

    await page.keyboard.press('Control+f');

    await expect(page.locator('[data-testid="board-search-bar"]')).not.toBeVisible();

    // Re-show
    await page.keyboard.press('Control+f');
    await expect(page.locator('[data-testid="board-search-bar"]')).toBeVisible();
  });

  test('Ctrl+F does not toggle off when query is active', async () => {
    const searchInput = page.locator('[data-testid="board-search-input"]');
    await searchInput.fill('login');

    await page.keyboard.press('Control+f');

    // Bar should remain visible
    await expect(page.locator('[data-testid="board-search-bar"]')).toBeVisible();
    await expect(searchInput).toBeFocused();

    // Clean up
    await searchInput.fill('');
  });
});
