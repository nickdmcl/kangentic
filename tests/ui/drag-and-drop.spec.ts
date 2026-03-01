import { test, expect } from '@playwright/test';
import { launchPage, waitForBoard, createProject, createTask } from './helpers';
import type { Browser, Page } from '@playwright/test';

const runId = Date.now();
const PROJECT_NAME = `DnD Test ${runId}`;
let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  const result = await launchPage();
  browser = result.browser;
  page = result.page;
  await createProject(page, PROJECT_NAME, '/tmp/dnd-test');
});

test.afterAll(async () => {
  await browser?.close();
});

async function ensureBoard() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const backlog = page.locator('[data-swimlane-name="Backlog"]');
  if (await backlog.isVisible().catch(() => false)) return;
  await page.locator(`[role="button"]:has-text("${PROJECT_NAME}")`).first().click();
  await waitForBoard(page);
}

/**
 * Drag a task card from its current column to a target column.
 * Uses mouse events to simulate @dnd-kit's PointerSensor (activation distance >= 5px).
 */
async function dragTaskToColumn(taskTitle: string, targetColumn: string) {
  const card = page
    .locator('[data-testid="swimlane"]')
    .locator(`text=${taskTitle}`)
    .first();
  await card.waitFor({ state: 'visible', timeout: 5000 });

  const target = page.locator(`[data-swimlane-name="${targetColumn}"]`);
  await target.waitFor({ state: 'visible', timeout: 5000 });

  // Scroll so both elements are in view
  await page.evaluate((targetCol) => {
    const targetEl = document.querySelector(`[data-swimlane-name="${targetCol}"]`);
    if (targetEl) targetEl.scrollIntoView({ inline: 'nearest', behavior: 'instant' });
  }, targetColumn);
  await page.waitForTimeout(100);

  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  if (!cardBox || !targetBox) throw new Error('Could not get bounding boxes for drag');

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + 80;

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  // Move enough to activate @dnd-kit's PointerSensor (distance >= 5)
  await page.mouse.move(startX + 10, startY, { steps: 3 });
  await page.waitForTimeout(100);

  // Move to target in steps
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.waitForTimeout(200);

  await page.mouse.up();
  await page.waitForTimeout(500);
}

/**
 * Drag a task card onto another task card within the same column.
 * Uses vertical mouse movement to trigger within-column reorder.
 */
async function dragTaskWithinColumn(sourceTitle: string, targetTitle: string) {
  const source = page
    .locator('[data-testid="swimlane"]')
    .locator(`text=${sourceTitle}`)
    .first();
  await source.waitFor({ state: 'visible', timeout: 5000 });

  const target = page
    .locator('[data-testid="swimlane"]')
    .locator(`text=${targetTitle}`)
    .first();
  await target.waitFor({ state: 'visible', timeout: 5000 });

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Could not get bounding boxes for within-column drag');

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  // Move enough to activate @dnd-kit's PointerSensor (distance >= 5)
  const direction = endY > startY ? 1 : -1;
  await page.mouse.move(startX, startY + direction * 10, { steps: 3 });
  await page.waitForTimeout(100);

  // Move to target position
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.waitForTimeout(200);

  await page.mouse.up();
  await page.waitForTimeout(500);
}

/**
 * Drag a task card to a position below a specific target task in another column.
 * Drops the card below the target task's midpoint so it inserts after it.
 */
async function dragTaskBelowTaskInColumn(taskTitle: string, targetTaskTitle: string, targetColumn: string) {
  const card = page
    .locator('[data-testid="swimlane"]')
    .locator(`text=${taskTitle}`)
    .first();
  await card.waitFor({ state: 'visible', timeout: 5000 });

  const targetCard = page
    .locator(`[data-swimlane-name="${targetColumn}"]`)
    .locator(`text=${targetTaskTitle}`)
    .first();
  await targetCard.waitFor({ state: 'visible', timeout: 5000 });

  // Scroll so both elements are in view
  await page.evaluate((targetCol) => {
    const targetEl = document.querySelector(`[data-swimlane-name="${targetCol}"]`);
    if (targetEl) targetEl.scrollIntoView({ inline: 'nearest', behavior: 'instant' });
  }, targetColumn);
  await page.waitForTimeout(100);

  const cardBox = await card.boundingBox();
  const targetBox = await targetCard.boundingBox();
  if (!cardBox || !targetBox) throw new Error('Could not get bounding boxes for drag');

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  // Drop below the target task's midpoint (bottom quarter)
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height * 0.75;

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  // Move enough to activate @dnd-kit's PointerSensor (distance >= 5)
  await page.mouse.move(startX + 10, startY, { steps: 3 });
  await page.waitForTimeout(100);

  // Move to target in steps
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.waitForTimeout(200);

  await page.mouse.up();
  await page.waitForTimeout(500);
}

test.describe('Drag and Drop', () => {
  test.beforeEach(async () => {
    await ensureBoard();
  });

  test('drag task from Backlog to Planning', async () => {
    const taskName = `DnD Plan ${runId}`;
    await createTask(page, taskName, 'Test drag to Planning');

    const backlog = page.locator('[data-swimlane-name="Backlog"]');
    await expect(backlog.locator(`text=${taskName}`).first()).toBeVisible();

    await dragTaskToColumn(taskName, 'Planning');

    const planning = page.locator('[data-swimlane-name="Planning"]');
    await expect(
      planning.locator(`text=${taskName}`).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(backlog.locator(`text=${taskName}`)).not.toBeVisible({ timeout: 3000 });
  });

  test('drag task from Backlog to Code Review', async () => {
    const taskName = `DnD Rev ${runId}`;
    await createTask(page, taskName, 'Test drag to Code Review');

    const backlog = page.locator('[data-swimlane-name="Backlog"]');
    await expect(backlog.locator(`text=${taskName}`).first()).toBeVisible();

    await dragTaskToColumn(taskName, 'Code Review');

    const review = page.locator('[data-swimlane-name="Code Review"]');
    await expect(
      review.locator(`text=${taskName}`).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(backlog.locator(`text=${taskName}`)).not.toBeVisible({ timeout: 3000 });
  });

  test('drag task from Planning to Code Review', async () => {
    const taskName = `DnD PtoR ${runId}`;
    await createTask(page, taskName, 'Test drag to Code Review', 'Planning');

    const planning = page.locator('[data-swimlane-name="Planning"]');
    await expect(planning.locator(`text=${taskName}`).first()).toBeVisible();

    await dragTaskToColumn(taskName, 'Code Review');
    const review = page.locator('[data-swimlane-name="Code Review"]');
    await expect(
      review.locator(`text=${taskName}`).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      planning.locator(`text=${taskName}`),
    ).not.toBeVisible({ timeout: 3000 });
  });

  test('drag task skipping columns (Backlog to Code Review)', async () => {
    const taskName = `DnD Skip ${runId}`;
    await createTask(page, taskName, 'Test skip columns');

    const backlog = page.locator('[data-swimlane-name="Backlog"]');
    await expect(backlog.locator(`text=${taskName}`).first()).toBeVisible();

    // Drag directly from Backlog to Code Review, skipping Planning
    await dragTaskToColumn(taskName, 'Code Review');
    const review = page.locator('[data-swimlane-name="Code Review"]');
    await expect(
      review.locator(`text=${taskName}`).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      backlog.locator(`text=${taskName}`),
    ).not.toBeVisible({ timeout: 3000 });
  });

  test('reorder task within column (top to bottom)', async () => {
    const task1 = `DnD Reorder1 ${runId}`;
    const task2 = `DnD Reorder2 ${runId}`;
    const task3 = `DnD Reorder3 ${runId}`;
    await createTask(page, task1, 'First task');
    await createTask(page, task2, 'Second task');
    await createTask(page, task3, 'Third task');

    const backlog = page.locator('[data-swimlane-name="Backlog"]');
    await expect(backlog.locator(`text=${task1}`).first()).toBeVisible();
    await expect(backlog.locator(`text=${task3}`).first()).toBeVisible();

    // Drag task1 onto task3 (top to bottom)
    await dragTaskWithinColumn(task1, task3);

    // Verify all tasks remain in Backlog (not moved to another column)
    await expect(backlog.locator(`text=${task1}`).first()).toBeVisible({ timeout: 5000 });
    await expect(backlog.locator(`text=${task2}`).first()).toBeVisible();
    await expect(backlog.locator(`text=${task3}`).first()).toBeVisible();

    // Verify order: task2 should appear above task1 after dragging task1 down
    const box1 = await backlog.locator(`text=${task1}`).first().boundingBox();
    const box2 = await backlog.locator(`text=${task2}`).first().boundingBox();
    expect(box1).toBeTruthy();
    expect(box2).toBeTruthy();
    expect(box2!.y).toBeLessThan(box1!.y);
  });

  test('reorder task within column (bottom to top)', async () => {
    const task1 = `DnD Up1 ${runId}`;
    const task2 = `DnD Up2 ${runId}`;
    const task3 = `DnD Up3 ${runId}`;
    await createTask(page, task1, 'First task', 'Planning');
    await createTask(page, task2, 'Second task', 'Planning');
    await createTask(page, task3, 'Third task', 'Planning');

    const planning = page.locator('[data-swimlane-name="Planning"]');
    await expect(planning.locator(`text=${task3}`).first()).toBeVisible();

    // Drag task3 onto task1 (bottom to top)
    await dragTaskWithinColumn(task3, task1);

    // Verify all tasks remain in Planning
    await expect(planning.locator(`text=${task1}`).first()).toBeVisible({ timeout: 5000 });
    await expect(planning.locator(`text=${task2}`).first()).toBeVisible();
    await expect(planning.locator(`text=${task3}`).first()).toBeVisible();

    // Verify order: task3 should appear above task2 after dragging task3 up
    const box3 = await planning.locator(`text=${task3}`).first().boundingBox();
    const box2 = await planning.locator(`text=${task2}`).first().boundingBox();
    expect(box3).toBeTruthy();
    expect(box2).toBeTruthy();
    expect(box3!.y).toBeLessThan(box2!.y);
  });

  test('cross-column drag respects drop position (not always top)', async () => {
    // Create two tasks in Code Review so there's an existing order
    const existing1 = `DnD Pos1 ${runId}`;
    const existing2 = `DnD Pos2 ${runId}`;
    const movingTask = `DnD PosMove ${runId}`;
    await createTask(page, existing1, 'Already in CR', 'Code Review');
    await createTask(page, existing2, 'Also in CR', 'Code Review');
    await createTask(page, movingTask, 'Will be moved');

    const review = page.locator('[data-swimlane-name="Code Review"]');
    const backlog = page.locator('[data-swimlane-name="Backlog"]');
    await expect(review.locator(`text=${existing1}`).first()).toBeVisible();
    await expect(review.locator(`text=${existing2}`).first()).toBeVisible();
    await expect(backlog.locator(`text=${movingTask}`).first()).toBeVisible();

    // Drag the Backlog task to below existing1 in Code Review
    await dragTaskBelowTaskInColumn(movingTask, existing1, 'Code Review');

    // Task should appear in Code Review
    await expect(
      review.locator(`text=${movingTask}`).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(backlog.locator(`text=${movingTask}`)).not.toBeVisible({ timeout: 3000 });

    // Verify positional ordering: existing1 should be above movingTask
    const boxExisting1 = await review.locator(`text=${existing1}`).first().boundingBox();
    const boxMoving = await review.locator(`text=${movingTask}`).first().boundingBox();
    expect(boxExisting1).toBeTruthy();
    expect(boxMoving).toBeTruthy();
    expect(boxExisting1!.y).toBeLessThan(boxMoving!.y);
  });
});
