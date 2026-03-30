/**
 * UI tests for the ActivityLog conversation view.
 *
 * Covers the three visually distinct states added in feat(activity-log):
 *   - User prompt  → sky-blue PromptLine (border-sky-500, "You" label)
 *   - Tool / think → zinc BadgeLine (default surface badge)
 *   - AI done      → emerald AiReadyLine ("AI Ready" pill, border-emerald-500)
 *   - Sticky header → last prompt text pinned at top while events scroll
 *
 * Tests run against the Vite dev server with a mocked Electron API so
 * no Electron process is required.
 */
import { test, expect } from '@playwright/test';
import { chromium, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForViteReady } from './helpers';

const MOCK_SCRIPT = path.join(__dirname, 'mock-electron-api.js');
const VITE_URL = `http://localhost:${process.env.PLAYWRIGHT_VITE_PORT || '5173'}`;

const PROJECT_ID = 'proj-activity-log-test';
const TASK_ID   = 'task-activity-log-test';
const SESSION_ID = 'sess-activity-log-test';

/** Build a pre-configure script that seeds the store with specific events. */
function makePreConfig(events: object[]): string {
  const eventsJson = JSON.stringify(events);
  return `
    window.__mockPreConfigure(function (state) {
      var ts = new Date().toISOString();

      state.projects.push({
        id: '${PROJECT_ID}',
        name: 'Activity Log Test',
        path: '/mock/activity-log-test',
        github_url: null,
        default_agent: 'claude',
        last_opened: ts,
        created_at: ts,
      });

      state.DEFAULT_SWIMLANES.forEach(function (s, i) {
        state.swimlanes.push(Object.assign({}, s, {
          id: 'lane-alog-' + i,
          position: i,
          created_at: ts,
        }));
      });

      state.sessions.push({
        id: '${SESSION_ID}',
        taskId: '${TASK_ID}',
        projectId: '${PROJECT_ID}',
        pid: 7777,
        status: 'running',
        shell: 'bash',
        cwd: '/mock/activity-log-test',
        startedAt: ts,
        exitCode: null,
        resuming: false,
      });

      state.activityCache['${SESSION_ID}'] = 'idle';

      // Seed the event cache with the provided events
      var events = ${eventsJson};
      state.eventCache['${SESSION_ID}'] = events;

      state.tasks.push({
        id: '${TASK_ID}',
        title: 'Activity Log Task',
        description: '',
        swimlane_id: 'lane-alog-0',
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

/** Click the "Activity" tab in the terminal panel. */
async function openActivityTab(page: Page): Promise<void> {
  const activityTab = page.locator('button', { hasText: 'Activity' }).first();
  await activityTab.waitFor({ state: 'visible', timeout: 10000 });
  await activityTab.click();
}

// ---------------------------------------------------------------------------
// 1. Empty state
// ---------------------------------------------------------------------------

test.describe('ActivityLog — empty state', () => {
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    ({ browser, page } = await launchWithState(makePreConfig([])));
    await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
    await openActivityTab(page);
  });

  test.afterAll(async () => { await browser?.close(); });

  test('shows waiting placeholder when there are no events', async () => {
    await expect(page.locator('text=Waiting for agent activity...')).toBeVisible();
  });

  test('does not show AI Ready or PromptLine in empty state', async () => {
    await expect(page.locator('text=AI Ready')).not.toBeVisible();
    // "You" label only appears inside PromptLine blocks
    const youLabel = page.locator('.text-sky-400', { hasText: 'You' });
    await expect(youLabel).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. PromptLine — sky-blue user message block
// ---------------------------------------------------------------------------

test.describe('ActivityLog — prompt event renders PromptLine', () => {
  let browser: Browser;
  let page: Page;

  const promptText = 'Build me a REST API with error handling';

  test.beforeAll(async () => {
    ({ browser, page } = await launchWithState(makePreConfig([
      { ts: Date.now(), type: 'prompt', detail: promptText },
    ])));
    await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
    await openActivityTab(page);
  });

  test.afterAll(async () => { await browser?.close(); });

  test('renders sky-blue prompt block with "You" label', async () => {
    // The PromptLine has border-sky-500 and a "You" label
    const promptBlock = page.locator('.border-sky-500').first();
    await expect(promptBlock).toBeVisible();
    await expect(promptBlock.locator('text=You')).toBeVisible();
  });

  test('shows the prompt text inside the prompt block', async () => {
    await expect(page.locator(`text=${promptText}`).first()).toBeVisible();
  });

  test('sticky header shows the last prompt text', async () => {
    // The sticky div appears only when there is a lastPromptText
    // It contains a "You" label at sky-400 and the truncated prompt text
    const stickyHeader = page.locator('.sticky.top-0').first();
    await expect(stickyHeader).toBeVisible();
    await expect(stickyHeader.locator('text=You')).toBeVisible();
    await expect(stickyHeader.locator(`text=${promptText}`)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. AiReadyLine — emerald AI-done signal
// ---------------------------------------------------------------------------

test.describe('ActivityLog — idle event renders AiReadyLine', () => {
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    ({ browser, page } = await launchWithState(makePreConfig([
      { ts: Date.now() - 2000, type: 'tool_start', tool: 'Read', detail: '/src/index.ts' },
      { ts: Date.now(),        type: 'idle' },
    ])));
    await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
    await openActivityTab(page);
  });

  test.afterAll(async () => { await browser?.close(); });

  test('shows "AI Ready" pill for idle event', async () => {
    await expect(page.locator('text=AI Ready')).toBeVisible();
  });

  test('AI Ready pill has emerald styling', async () => {
    // The AiReadyLine wraps in a div with border-emerald-500
    const aiReadyBlock = page.locator('.border-emerald-500').first();
    await expect(aiReadyBlock).toBeVisible();
    await expect(aiReadyBlock.locator('text=AI Ready')).toBeVisible();
  });

  test('tool_start before idle renders a tool badge (zinc surface)', async () => {
    // BadgeLine for tool_start renders the tool name
    await expect(page.getByText('Read', { exact: true })).toBeVisible();
  });

  test('idle event does NOT show sticky header (no prompt in cache)', async () => {
    // No prompt event → lastPromptText is null → no sticky header
    const youLabels = page.locator('.sticky.top-0');
    await expect(youLabels).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Full conversation: prompt → tools → idle (all three states together)
// ---------------------------------------------------------------------------

test.describe('ActivityLog — full conversation renders all three states', () => {
  let browser: Browser;
  let page: Page;

  const userPrompt = 'Refactor the auth module to use JWT';

  test.beforeAll(async () => {
    const now = Date.now();
    ({ browser, page } = await launchWithState(makePreConfig([
      { ts: now - 5000, type: 'prompt',     detail: userPrompt },
      { ts: now - 4000, type: 'tool_start', tool: 'Read',  detail: '/src/auth.ts' },
      { ts: now - 3000, type: 'tool_start', tool: 'Write', detail: '/src/auth.ts' },
      { ts: now - 1000, type: 'idle' },
    ])));
    await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
    await openActivityTab(page);
  });

  test.afterAll(async () => { await browser?.close(); });

  test('sticky header shows the user prompt', async () => {
    const stickyHeader = page.locator('.sticky.top-0').first();
    await expect(stickyHeader).toBeVisible();
    await expect(stickyHeader.locator(`text=${userPrompt}`)).toBeVisible();
  });

  test('PromptLine is rendered in the event stream', async () => {
    // There are two "You" labels: one in the sticky header, one in the PromptLine row
    const youLabels = page.locator('.text-sky-400', { hasText: 'You' });
    await expect(youLabels).toHaveCount(2);
  });

  test('"AI Ready" pill appears at the end of the stream', async () => {
    await expect(page.locator('text=AI Ready')).toBeVisible();
  });

  test('tool events render between prompt and AI Ready', async () => {
    await expect(page.getByText('Read', { exact: true })).toBeVisible();
    await expect(page.getByText('Write', { exact: true })).toBeVisible();
  });

  test('prompt text truncates at 160 chars with ellipsis', async () => {
    // This prompt is short — verify it renders untruncated
    const promptBlock = page.locator('.border-sky-500').first();
    await expect(promptBlock.locator(`text=${userPrompt}`)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Prompt truncation at PROMPT_DISPLAY_CHARS = 160
// ---------------------------------------------------------------------------

test.describe('ActivityLog — prompt text truncation', () => {
  let browser: Browser;
  let page: Page;

  // 200-char prompt (40 chars over the 160-char limit)
  const longPrompt = 'A'.repeat(160) + 'B'.repeat(40);
  const truncated   = 'A'.repeat(160) + '…';
  const overflow    = 'B'.repeat(40);

  test.beforeAll(async () => {
    ({ browser, page } = await launchWithState(makePreConfig([
      { ts: Date.now(), type: 'prompt', detail: longPrompt },
    ])));
    await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
    await openActivityTab(page);
  });

  test.afterAll(async () => { await browser?.close(); });

  test('long prompt is truncated with ellipsis at 160 chars in event stream', async () => {
    await expect(page.locator(`text=${truncated}`).first()).toBeVisible();
    await expect(page.locator(`text=${overflow}`)).not.toBeVisible();
  });

  test('sticky header also truncates the long prompt', async () => {
    const stickyHeader = page.locator('.sticky.top-0').first();
    await expect(stickyHeader.locator(`text=${truncated}`)).toBeVisible();
  });
});
