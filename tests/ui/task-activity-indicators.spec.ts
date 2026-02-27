/**
 * UI tests for task card activity indicators during initialization.
 *
 * When a task first spawns a session, the backend defaults activity to 'idle'
 * before any hooks fire. During this initializing phase (no usage data yet),
 * the card should show the thinking spinner (Loader2), not the idle icon (Mail).
 */
import { test, expect } from '@playwright/test';
import { chromium, type Browser, type Page } from '@playwright/test';
import path from 'node:path';

const MOCK_SCRIPT = path.join(__dirname, 'mock-electron-api.js');
const VITE_URL = `http://localhost:${process.env.PLAYWRIGHT_VITE_PORT || '5173'}`;

/**
 * Launch a page with pre-configured mock state.
 * The preConfigScript string is evaluated via addInitScript after the mock
 * is injected but before React mounts, so stores load the pre-set data.
 */
async function launchWithState(preConfigScript: string): Promise<{ browser: Browser; page: Page }> {
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

/** Shared IDs used across pre-configure scripts */
const PROJECT_ID = 'proj-activity-test';
const TASK_ID = 'task-activity-test';
const SESSION_ID = 'sess-activity-test';
const SWIMLANE_ID = 'lane-backlog';

/** Base pre-configure that creates a project with a task linked to a running session */
function makePreConfig(opts: { sessionStatus: string; activity: string; withUsage: boolean }): string {
  return `
    window.__mockPreConfigure(function (state) {
      var ts = new Date().toISOString();

      state.projects.push({
        id: '${PROJECT_ID}',
        name: 'Activity Test',
        path: '/mock/activity-test',
        github_url: null,
        default_agent: 'claude',
        last_opened: ts,
        created_at: ts,
      });

      state.DEFAULT_SWIMLANES.forEach(function (s, i) {
        var id = i === 0 ? '${SWIMLANE_ID}' : state.uuid();
        state.swimlanes.push({
          id: id,
          name: s.name,
          role: s.role,
          color: s.color,
          icon: s.icon,
          is_terminal: s.is_terminal,
          position: i,
          created_at: ts,
        });
      });

      state.sessions.push({
        id: '${SESSION_ID}',
        taskId: '${TASK_ID}',
        pid: 9999,
        status: '${opts.sessionStatus}',
        shell: 'bash',
        cwd: '/mock/activity-test',
        startedAt: ts,
        exitCode: null,
      });

      state.activityCache['${SESSION_ID}'] = '${opts.activity}';

      state.tasks.push({
        id: '${TASK_ID}',
        title: 'Test Initializing Task',
        description: '',
        swimlane_id: '${SWIMLANE_ID}',
        position: 0,
        agent: null,
        session_id: ${opts.sessionStatus === 'suspended' ? 'null' : `'${SESSION_ID}'`},
        worktree_path: null,
        branch_name: null,
        pr_number: null,
        pr_url: null,
        base_branch: null,
        archived_at: null,
        created_at: ts,
        updated_at: ts,
      });

      return { currentProjectId: '${PROJECT_ID}' };
    });
    ${opts.withUsage ? `
    // Override getUsage to return mock usage data for this session
    var origGetUsage = window.electronAPI.sessions.getUsage;
    window.electronAPI.sessions.getUsage = async function () {
      var result = {};
      result['${SESSION_ID}'] = {
        model: { id: 'claude-sonnet', displayName: 'Claude Sonnet' },
        contextWindow: { usedPercentage: 25, totalInputTokens: 1000, totalOutputTokens: 500, contextWindowSize: 200000 },
        cost: { totalCostUsd: 0.01, totalDurationMs: 5000 },
      };
      return result;
    };
    ` : ''}
  `;
}

test.describe('Task Activity Indicators', () => {
  test('initializing task shows thinking spinner, not idle mail icon', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'running', activity: 'idle', withUsage: false })
    );

    try {
      // Wait for the board and task card to render
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator('text=Test Initializing Task').first();
      await expect(card).toBeVisible();

      // The card's title row should contain the Loader2 spinner (thinking)
      const titleRow = card.locator('..');
      await expect(titleRow.locator('.lucide-loader-circle')).toBeVisible();
      // The Mail icon (idle) should NOT be present
      await expect(titleRow.locator('.lucide-mail')).not.toBeVisible();

      // The initializing bar should also be shown
      await expect(page.locator('[data-testid="initializing-bar"]')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('task with usage data and idle activity shows mail icon', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'running', activity: 'idle', withUsage: true })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator('text=Test Initializing Task').first();
      await expect(card).toBeVisible();

      // With usage data present, idle activity → Mail icon
      const titleRow = card.locator('..');
      await expect(titleRow.locator('.lucide-mail')).toBeVisible();
      // Loader2 spinner should NOT be present
      await expect(titleRow.locator('.lucide-loader-circle')).not.toBeVisible();

      // Usage bar should be shown instead of initializing bar
      await expect(page.locator('[data-testid="usage-bar"]')).toBeVisible();
      await expect(page.locator('[data-testid="initializing-bar"]')).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('suspended task during initialization shows neither activity icon', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'suspended', activity: 'idle', withUsage: false })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator('text=Test Initializing Task').first();
      await expect(card).toBeVisible();

      // Suspended task: session_id is null, so no activity icons
      const titleRow = card.locator('..');
      await expect(titleRow.locator('.lucide-mail')).not.toBeVisible();
      await expect(titleRow.locator('.lucide-loader-circle')).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
