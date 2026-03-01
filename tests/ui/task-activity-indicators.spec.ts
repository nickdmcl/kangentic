/**
 * UI tests for task card activity indicators during initialization.
 *
 * When a task first spawns a session, the backend defaults activity to 'idle'
 * before any hooks fire. During this initializing phase (no usage data yet),
 * the card should show only the "Initializing..." bottom bar — no title icon.
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
function makePreConfig(opts: { sessionStatus: string; activity: string; withUsage: boolean; nullSessionId?: boolean; withEvents?: boolean }): string {
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
          permission_strategy: s.permission_strategy ?? null,
          auto_spawn: s.auto_spawn ?? false,
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
      ${opts.withEvents ? `
      state.eventCache['${SESSION_ID}'] = [
        { ts: Date.now(), type: 'tool_start', tool: 'Read', detail: '/mock/file.ts' },
      ];
      ` : ''}

      state.tasks.push({
        id: '${TASK_ID}',
        title: 'Test Initializing Task',
        description: '',
        swimlane_id: '${SWIMLANE_ID}',
        position: 0,
        agent: null,
        session_id: ${opts.sessionStatus === 'suspended' || opts.nullSessionId ? 'null' : `'${SESSION_ID}'`},
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
        contextWindow: { usedPercentage: 25, usedTokens: 1500, cacheTokens: 0, totalInputTokens: 1000, totalOutputTokens: 500, contextWindowSize: 200000 },
        cost: { totalCostUsd: 0.01, totalDurationMs: 5000 },
      };
      return result;
    };
    ` : ''}
  `;
}

test.describe('Task Activity Indicators', () => {
  test('initializing task shows no title icon, only bottom bar', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'running', activity: 'idle', withUsage: false })
    );

    try {
      // Wait for the board and task card to render
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator('text=Test Initializing Task').first();
      await expect(card).toBeVisible();

      // During initializing, no title icon should appear (matches Queued/Suspended)
      const titleRow = card.locator('..');
      await expect(titleRow.locator('.lucide-loader-circle')).not.toBeVisible();
      await expect(titleRow.locator('.lucide-mail')).not.toBeVisible();

      // The initializing bottom bar should be shown
      await expect(page.locator('[data-testid="status-bar"]')).toBeVisible();
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

      // Usage bar should be shown on the card instead of initializing bar
      const cardEl = page.locator(`[data-task-id="${TASK_ID}"]`);
      await expect(cardEl.locator('[data-testid="usage-bar"]')).toBeVisible();
      await expect(cardEl.locator('[data-testid="status-bar"]')).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('context bar places separator between cost and token counts', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'running', activity: 'idle', withUsage: true })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      // Open task detail dialog
      await page.locator('text=Test Initializing Task').first().click();
      await page.waitForTimeout(300);

      // Target the ContextBar (h-8 flex row), not the card's inline usage bar
      const usageBar = page.locator('[data-testid="usage-bar"].h-8');
      await expect(usageBar).toBeVisible();

      // Verify ordering: cost pill text → separator div → tokens pill text
      // Get all direct children of the usage bar and check their text/role
      const children = usageBar.locator('> *');
      const texts = await children.evaluateAll((els) =>
        els.map((el) => ({
          text: el.textContent?.trim() || '',
          isSeparator: el.classList.contains('bg-surface-hover') && el.classList.contains('w-px'),
        }))
      );

      // Find cost pill (contains "$"), separator, and tokens pill (contains formatted numbers)
      const costIdx = texts.findIndex((t) => t.text.includes('$'));
      const separatorIdx = texts.findIndex((t, i) => i > costIdx && t.isSeparator);
      const tokensIdx = texts.findIndex((t) => t.text.includes('1k'));

      expect(costIdx).toBeGreaterThanOrEqual(0);
      expect(separatorIdx).toBeGreaterThan(costIdx);
      expect(tokensIdx).toBeGreaterThan(separatorIdx);
    } finally {
      await browser.close();
    }
  });

  test('status bar shows separate token and cost spans when usage exists', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'running', activity: 'idle', withUsage: true })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });

      // Both spans should be visible in the status bar
      const tokens = page.locator('[data-testid="aggregate-tokens"]');
      const cost = page.locator('[data-testid="aggregate-cost"]');
      await expect(tokens).toBeVisible();
      await expect(cost).toBeVisible();

      // Verify content — icons are SVGs, so check for numeric token text
      await expect(tokens).toContainText('1k');
      await expect(cost).toContainText('$');
    } finally {
      await browser.close();
    }
  });

  test('exited session does not show initializing bar', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'exited', activity: 'idle', withUsage: false })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator('text=Test Initializing Task').first();
      await expect(card).toBeVisible();

      // Exited session should not trigger the initializing spinner
      const titleRow = card.locator('..');
      await expect(titleRow.locator('.lucide-loader-circle')).not.toBeVisible();
      await expect(page.locator('[data-testid="status-bar"]')).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('stale exited session with null session_id does not show initializing bar', async () => {
    // Reproduces the exact bug: task moved back to Backlog clears session_id
    // but the session object remains in the list (matched by taskId).
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'exited', activity: 'idle', withUsage: false, nullSessionId: true })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator('text=Test Initializing Task').first();
      await expect(card).toBeVisible();

      // Task has session_id=null, but a stale exited session still in list by taskId.
      // Should not show any spinner or initializing bar.
      const titleRow = card.locator('..');
      await expect(titleRow.locator('.lucide-loader-circle')).not.toBeVisible();
      await expect(titleRow.locator('.lucide-mail')).not.toBeVisible();
      await expect(page.locator('[data-testid="status-bar"]')).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('task with events but no usage still shows initializing (usage required)', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'running', activity: 'idle', withUsage: false, withEvents: true })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator('text=Test Initializing Task').first();
      await expect(card).toBeVisible();

      // Events may arrive before usage, but "Initializing..." persists until
      // usage data lands — no title icon (idle/thinking) without usage.
      const titleRow = card.locator('..');
      await expect(titleRow.locator('.lucide-mail')).not.toBeVisible();
      await expect(titleRow.locator('.lucide-loader-circle')).not.toBeVisible();

      // Initializing bar still visible — usage is the gate, not events
      await expect(page.locator('[data-testid="status-bar"]')).toBeVisible();
      await expect(page.locator('text=Initializing...')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('task with events and thinking activity still shows initializing without usage', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'running', activity: 'thinking', withUsage: false, withEvents: true })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator('text=Test Initializing Task').first();
      await expect(card).toBeVisible();

      // Even with thinking activity + events, no usage = still initializing.
      // The progress bar needs usage data (model name, context %) to render.
      const titleRow = card.locator('..');
      await expect(titleRow.locator('.lucide-loader-circle')).not.toBeVisible();
      await expect(titleRow.locator('.lucide-mail')).not.toBeVisible();

      // Initializing bar persists until usage arrives
      await expect(page.locator('[data-testid="status-bar"]')).toBeVisible();
      await expect(page.locator('text=Initializing...')).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('task with session opens detail dialog in view mode (not edit mode)', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'running', activity: 'idle', withUsage: true })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator('text=Test Initializing Task').first();
      await card.click();
      await page.waitForTimeout(300);

      // Should open in view mode — h2 heading visible, no title input
      const heading = page.locator('.fixed h2:has-text("Test Initializing Task")');
      await expect(heading).toBeVisible();
      const titleInput = page.locator('.fixed input[type="text"]');
      await expect(titleInput).not.toBeVisible();

      await page.keyboard.press('Escape');
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

  test('queued task shows "Queued..." bottom bar with spinner', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'queued', activity: 'idle', withUsage: false })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator(`[data-task-id="${TASK_ID}"]`);
      await expect(card).toBeVisible();

      // Queued card should show spinner + "Queued..." text in bottom bar
      const bottomBar = card.locator('[data-testid="status-bar"]');
      await expect(bottomBar).toBeVisible();
      await expect(bottomBar).toContainText('Queued...');
      await expect(bottomBar.locator('.lucide-loader-circle')).toBeVisible();

      // No title-row activity icons
      const titleRow = card.locator('text=Test Initializing Task').first().locator('..');
      await expect(titleRow.locator('.lucide-mail')).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('suspended task shows "Paused" bottom bar with pause icon', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'suspended', activity: 'idle', withUsage: false })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator(`[data-task-id="${TASK_ID}"]`);
      await expect(card).toBeVisible();

      // Suspended card should show "Paused" text with CirclePause icon
      const bottomBar = card.locator('[data-testid="status-bar"]');
      await expect(bottomBar).toBeVisible();
      await expect(bottomBar).toContainText('Paused');
      await expect(bottomBar.locator('.lucide-circle-pause')).toBeVisible();

      // No spinner in bottom bar
      await expect(bottomBar.locator('.lucide-loader-circle')).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('suspended task dialog shows wide layout with Resume button', async () => {
    const { browser, page } = await launchWithState(
      makePreConfig({ sessionStatus: 'suspended', activity: 'idle', withUsage: false })
    );

    try {
      await page.locator('[data-swimlane-name="Backlog"]').waitFor({ state: 'visible', timeout: 15000 });

      // Click the card to open the detail dialog
      await page.locator('text=Test Initializing Task').first().click();

      // "Resume session" button should be present in the suspended placeholder
      const resumeBtn = page.locator('text=Resume session');
      await expect(resumeBtn).toBeVisible({ timeout: 5000 });

      // Dialog container should be in wide mode for suspended sessions
      const dialogPanel = page.locator('[data-testid="task-detail-dialog"]');
      await expect(dialogPanel).toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
