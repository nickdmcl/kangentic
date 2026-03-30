/**
 * UI tests for the card subtitle "last result text" feature.
 *
 * When a session has a Notification or TaskCompleted event, the card
 * subtitle should display the most recent result text (with a '›' marker)
 * instead of the initial task description. Falls back to description when
 * no result events exist.
 */
import { test, expect } from '@playwright/test';
import { chromium, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForViteReady } from './helpers';

const MOCK_SCRIPT = path.join(__dirname, 'mock-electron-api.js');
const VITE_URL = `http://localhost:${process.env.PLAYWRIGHT_VITE_PORT || '5173'}`;

const PROJECT_ID = 'proj-result-text-test';
const TASK_ID = 'task-result-text-test';
const SESSION_ID = 'sess-result-text-test';
const SWIMLANE_ID = 'lane-result-text';

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

/** Build a preconfig script that sets up a project+task+session with optional events and description. */
function makeConfig(opts: {
  description?: string;
  eventsJson: string;  // pre-serialised JS array literal (evaluated in browser)
}): string {
  const desc = JSON.stringify(opts.description ?? '');
  return `
    window.__mockPreConfigure(function (state) {
      var ts = new Date().toISOString();

      state.projects.push({
        id: '${PROJECT_ID}',
        name: 'Result Text Test',
        path: '/mock/result-text-test',
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
          is_archived: s.is_archived,
          permission_strategy: s.permission_strategy ?? null,
          auto_spawn: s.auto_spawn ?? false,
          position: i,
          created_at: ts,
        });
      });

      state.sessions.push({
        id: '${SESSION_ID}',
        taskId: '${TASK_ID}',
        projectId: '${PROJECT_ID}',
        pid: 9999,
        status: 'running',
        shell: 'bash',
        cwd: '/mock/result-text-test',
        startedAt: ts,
        exitCode: null,
      });

      state.activityCache['${SESSION_ID}'] = 'idle';
      state.eventCache['${SESSION_ID}'] = ${opts.eventsJson};

      state.tasks.push({
        id: '${TASK_ID}',
        title: 'Result Text Task',
        description: ${desc},
        swimlane_id: '${SWIMLANE_ID}',
        position: 0,
        agent: null,
        session_id: '${SESSION_ID}',
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
  `;
}

test.describe('Task card result text', () => {

  test('shows notification event detail as card subtitle', async () => {
    const { browser, page } = await launchWithState(makeConfig({
      description: 'Original description',
      eventsJson: `[
        { ts: Date.now() - 1000, type: 'tool_start', tool: 'Read', detail: '/mock/file.ts' },
        { ts: Date.now(),        type: 'notification', detail: 'Found 3 issues in the codebase' }
      ]`,
    }));

    try {
      await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator(`[data-task-id="${TASK_ID}"]`);

      // Result indicator must be present
      await expect(card.locator('[title="Latest AI result"]')).toBeVisible();
      // Notification text must appear
      await expect(card).toContainText('Found 3 issues in the codebase');
      // Original description must NOT appear (result takes over)
      await expect(card).not.toContainText('Original description');
    } finally {
      await browser.close();
    }
  });

  test('shows the most recent notification when multiple exist', async () => {
    const { browser, page } = await launchWithState(makeConfig({
      eventsJson: `[
        { ts: Date.now() - 2000, type: 'notification', detail: 'First notification' },
        { ts: Date.now() - 1000, type: 'tool_start',   tool: 'Write', detail: '/mock/out.ts' },
        { ts: Date.now(),        type: 'notification', detail: 'Second and latest notification' }
      ]`,
    }));

    try {
      await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator(`[data-task-id="${TASK_ID}"]`);

      await expect(card).toContainText('Second and latest notification');
      await expect(card).not.toContainText('First notification');
    } finally {
      await browser.close();
    }
  });

  test('shows task_completed event detail as card subtitle', async () => {
    const { browser, page } = await launchWithState(makeConfig({
      eventsJson: `[
        { ts: Date.now(), type: 'task_completed', detail: 'Refactoring complete' }
      ]`,
    }));

    try {
      await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator(`[data-task-id="${TASK_ID}"]`);

      await expect(card.locator('[title="Latest AI result"]')).toBeVisible();
      await expect(card).toContainText('Refactoring complete');
    } finally {
      await browser.close();
    }
  });

  test('falls back to task description when no result events exist', async () => {
    const { browser, page } = await launchWithState(makeConfig({
      description: 'The original task description',
      eventsJson: `[
        { ts: Date.now() - 1000, type: 'tool_start', tool: 'Read', detail: '/mock/file.ts' },
        { ts: Date.now(),        type: 'tool_end',   tool: 'Read' }
      ]`,
    }));

    try {
      await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator(`[data-task-id="${TASK_ID}"]`);

      // Description should appear as fallback
      await expect(card).toContainText('The original task description');
      // No result indicator since no notification event
      await expect(card.locator('[title="Latest AI result"]')).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('strips markdown formatting from notification detail', async () => {
    const { browser, page } = await launchWithState(makeConfig({
      eventsJson: `[
        { ts: Date.now(), type: 'notification', detail: '**Done** — 3 files changed' }
      ]`,
    }));

    try {
      await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
      const card = page.locator(`[data-task-id="${TASK_ID}"]`);

      // The word "Done" should appear without surrounding ** markers
      await expect(card).toContainText('Done');
      await expect(card).not.toContainText('**Done**');
    } finally {
      await browser.close();
    }
  });

});
