/**
 * UI tests for the confirmation dialog when moving a task to the Done column.
 *
 * Moving to Done deletes the local worktree (branch + session history are
 * preserved). A confirmation dialog appears by default; users can opt into
 * silent auto-delete via a "Delete automatically in the future" checkbox that
 * sets config.skipDoneWorktreeConfirm.
 */
import { test, expect } from '@playwright/test';
import { chromium, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForViteReady } from './helpers';

const MOCK_SCRIPT = path.join(__dirname, 'mock-electron-api.js');
const VITE_URL = `http://localhost:${process.env.PLAYWRIGHT_VITE_PORT || '5173'}`;

const PROJECT_ID = 'proj-done-confirm';
const TASK_ID = 'task-done-confirm';

async function launchWithState(preConfigScript: string): Promise<{ browser: Browser; page: Page }> {
  await waitForViteReady(VITE_URL);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  await page.addInitScript({ path: MOCK_SCRIPT });
  await page.addInitScript(preConfigScript);

  await page.goto(VITE_URL);
  await page.waitForLoadState('load');
  await page.waitForSelector('text=Kangentic', { timeout: 15000 });

  return { browser, page };
}

function makePreConfig(options: { skipConfirm?: boolean } = {}): string {
  const skipConfirm = options.skipConfirm === true;
  return `
    window.__mockConfigOverrides = Object.assign(
      window.__mockConfigOverrides || {},
      { skipDoneWorktreeConfirm: ${skipConfirm} }
    );
    // The mock reads __mockConfigOverrides synchronously at init time; if the
    // preconfig script runs after the mock is already initialised we also push
    // the override through electronAPI.config.set so it lands before the
    // Zustand store reads the effective config.
    if (typeof window.electronAPI !== 'undefined' && window.electronAPI.config) {
      void window.electronAPI.config.set({ skipDoneWorktreeConfirm: ${skipConfirm} });
    }
    window.__mockPreConfigure(function (state) {
      var ts = new Date().toISOString();

      state.projects.push({
        id: '${PROJECT_ID}',
        name: 'Done Confirm Test',
        path: '/mock/done-confirm-test',
        github_url: null,
        default_agent: 'claude',
        last_opened: ts,
        created_at: ts,
      });

      var laneIds = {};
      state.DEFAULT_SWIMLANES.forEach(function (s, i) {
        var id = 'lane-' + s.name.toLowerCase().replace(/\\s+/g, '-');
        laneIds[s.name] = id;
        state.swimlanes.push(Object.assign({}, s, {
          id: id,
          position: i,
          created_at: ts,
        }));
      });

      var planningLane = state.swimlanes.find(function (s) { return s.name === 'Planning'; });
      var executingLane = state.swimlanes.find(function (s) { return s.name === 'Executing'; });
      if (planningLane && executingLane) {
        planningLane.plan_exit_target_id = executingLane.id;
      }

      state.tasks.push({
        id: '${TASK_ID}',
        title: 'Ready To Ship',
        description: 'A task about to move to Done',
        swimlane_id: laneIds['Executing'],
        position: 0,
        agent: 'claude',
        session_id: null,
        worktree_path: '/mock/worktrees/ready-to-ship',
        branch_name: 'ready-to-ship-abcd1234',
        pr_number: null,
        pr_url: null,
        base_branch: 'main',
        use_worktree: 1,
        labels: [],
        priority: 0,
        attachment_count: 0,
        archived_at: null,
        created_at: ts,
        updated_at: ts,
      });

      return { currentProjectId: '${PROJECT_ID}' };
    });
  `;
}

async function dragTaskToColumn(page: Page, taskTitle: string, targetColumn: string): Promise<void> {
  const card = page
    .locator('[data-testid="swimlane"]')
    .locator(`text=${taskTitle}`)
    .first();
  await card.waitFor({ state: 'visible', timeout: 5000 });

  const target = page.locator(`[data-swimlane-name="${targetColumn}"]`);
  await target.waitFor({ state: 'visible', timeout: 5000 });

  await page.evaluate((targetCol: string) => {
    const targetElement = document.querySelector(`[data-swimlane-name="${targetCol}"]`);
    if (targetElement) targetElement.scrollIntoView({ inline: 'nearest', behavior: 'instant' });
  }, targetColumn);
  await page.waitForTimeout(100);

  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  if (!cardBox || !targetBox) throw new Error('Could not get bounding boxes for drag');

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + 120;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY, { steps: 3 });
  await page.waitForTimeout(100);
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(500);
}

test.describe('Move to Done - Delete Worktree Confirmation', () => {
  test('shows confirmation dialog when dropping a task on Done', async () => {
    const { browser, page } = await launchWithState(makePreConfig());

    try {
      await page.locator('[data-swimlane-name="Done"]').waitFor({ state: 'visible', timeout: 15000 });

      const executingColumn = page.locator('[data-swimlane-name="Executing"]');
      await expect(executingColumn.locator('text=Ready To Ship')).toBeVisible();

      await dragTaskToColumn(page, 'Ready To Ship', 'Done');

      const dialog = page.locator('text=Delete worktree?');
      await expect(dialog).toBeVisible({ timeout: 3000 });

      // Dialog mentions that branch + session history are preserved
      await expect(page.locator('text=session history and branch are preserved')).toBeVisible();

      await expect(page.locator('button:has-text("Delete")').first()).toBeVisible();
      await expect(page.locator('button:has-text("Cancel")')).toBeVisible();
      await expect(page.locator('text=Delete automatically in the future')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('cancel leaves the task in its original column', async () => {
    const { browser, page } = await launchWithState(makePreConfig());

    try {
      await page.locator('[data-swimlane-name="Done"]').waitFor({ state: 'visible', timeout: 15000 });

      await dragTaskToColumn(page, 'Ready To Ship', 'Done');
      await expect(page.locator('text=Delete worktree?')).toBeVisible({ timeout: 3000 });

      await page.locator('button:has-text("Cancel")').click();

      await expect(page.locator('text=Delete worktree?')).toBeHidden({ timeout: 3000 });

      const executingColumn = page.locator('[data-swimlane-name="Executing"]');
      await expect(executingColumn.locator('text=Ready To Ship')).toBeVisible();

      // Cancel is a no-op - the config flag is still the default
      const skipConfirm = await page.evaluate(async () => {
        const config = await (window as unknown as { electronAPI: { config: { get: () => Promise<{ skipDoneWorktreeConfirm: boolean }> } } }).electronAPI.config.get();
        return config.skipDoneWorktreeConfirm;
      });
      expect(skipConfirm).toBe(false);
    } finally {
      await browser.close();
    }
  });

  test('confirm with "don\'t ask again" persists the config flag', async () => {
    const { browser, page } = await launchWithState(makePreConfig());

    try {
      await page.locator('[data-swimlane-name="Done"]').waitFor({ state: 'visible', timeout: 15000 });

      await dragTaskToColumn(page, 'Ready To Ship', 'Done');
      await expect(page.locator('text=Delete worktree?')).toBeVisible({ timeout: 3000 });

      // Tick the "Delete automatically in the future" checkbox
      const toggle = page.locator('text=Delete automatically in the future');
      await toggle.click();

      await page.locator('button:has-text("Delete")').first().click();
      await expect(page.locator('text=Delete worktree?')).toBeHidden({ timeout: 3000 });

      // Config should now be flipped so future Done drops skip the dialog
      const skipConfirm = await page.evaluate(async () => {
        const config = await (window as unknown as { electronAPI: { config: { get: () => Promise<{ skipDoneWorktreeConfirm: boolean }> } } }).electronAPI.config.get();
        return config.skipDoneWorktreeConfirm;
      });
      expect(skipConfirm).toBe(true);
    } finally {
      await browser.close();
    }
  });

  test('no dialog when skipDoneWorktreeConfirm is already true', async () => {
    const { browser, page } = await launchWithState(makePreConfig({ skipConfirm: true }));

    try {
      await page.locator('[data-swimlane-name="Done"]').waitFor({ state: 'visible', timeout: 15000 });

      await dragTaskToColumn(page, 'Ready To Ship', 'Done');

      // No confirmation dialog at all
      await expect(page.locator('text=Delete worktree?')).toBeHidden({ timeout: 2000 });
    } finally {
      await browser.close();
    }
  });
});
