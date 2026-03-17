import { test, expect, type Page } from '@playwright/test';
import { launchPage, waitForBoard, createProject } from './helpers';

let page: Page;

test.beforeEach(async () => {
  const launched = await launchPage();
  page = launched.page;
  await createProject(page, 'Alpha');
  await createProject(page, 'Beta');
});

test.afterEach(async () => {
  await page.context().browser()?.close();
});

async function createGroup(page: Page, name: string): Promise<void> {
  await page.locator('button[title="New group"]').click();
  const input = page.locator('input[placeholder="Group name"]');
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press('Enter');
  await expect(input).toBeHidden();
}

test.describe('Project Groups', () => {
  test('can create a project group', async () => {
    await createGroup(page, 'Work');
    await expect(page.locator('text=Work').first()).toBeVisible();
  });

  test('Escape cancels group creation', async () => {
    await page.locator('button[title="New group"]').click();
    const input = page.locator('input[placeholder="Group name"]');
    await expect(input).toBeVisible();
    await input.press('Escape');
    await expect(input).toBeHidden();
  });

  test('clicking Group button again cancels creation', async () => {
    const groupButton = page.locator('button[title="New group"]');
    await groupButton.click();
    const input = page.locator('input[placeholder="Group name"]');
    await expect(input).toBeVisible();
    await groupButton.click();
    await expect(input).toBeHidden();
  });

  test('collapse hides projects and shows count', async () => {
    const sidebar = page.locator('.bg-surface-raised').first();
    await createGroup(page, 'MyGroup');

    // Move Alpha to MyGroup via context menu
    await sidebar.locator('.truncate.font-medium:text("Alpha")').click({ button: 'right' });
    await page.locator('.fixed.bg-surface-raised').locator('text=MyGroup').click();

    // Move Beta to MyGroup via context menu
    await sidebar.locator('.truncate.font-medium:text("Beta")').click({ button: 'right' });
    await page.locator('.fixed.bg-surface-raised').locator('text=MyGroup').click();

    // Both projects should be visible under the group
    await expect(sidebar.locator('.truncate.font-medium:text("Alpha")')).toBeVisible();
    await expect(sidebar.locator('.truncate.font-medium:text("Beta")')).toBeVisible();

    // Click the group header's text area to collapse (avoid action buttons)
    const groupHeader = page.locator('[data-testid^="project-group-"]');
    const groupName = groupHeader.locator('text=MyGroup');
    await groupName.click();

    // Projects should be hidden in sidebar
    await expect(sidebar.locator('.truncate.font-medium:text("Alpha")')).toBeHidden();
    await expect(sidebar.locator('.truncate.font-medium:text("Beta")')).toBeHidden();

    // Count pill should show "2 projects" in the group header
    await expect(groupHeader.locator('text=2 projects')).toBeVisible();

    // Click again to expand
    await groupName.click();
    await expect(sidebar.locator('.truncate.font-medium:text("Alpha")')).toBeVisible();
    await expect(sidebar.locator('.truncate.font-medium:text("Beta")')).toBeVisible();
  });

  test('can rename a group', async () => {
    await createGroup(page, 'OldName');
    await expect(page.locator('text=OldName').first()).toBeVisible();

    // Hover the group header to reveal actions, then click rename
    const groupHeader = page.locator('[data-testid^="project-group-"]');
    await groupHeader.hover();
    await page.locator('button[title="Rename group"]').click();

    // Type new name and confirm
    const renameInput = groupHeader.locator('input');
    await renameInput.fill('NewName');
    await renameInput.press('Enter');

    await expect(page.locator('text=NewName').first()).toBeVisible();
  });

  test('can delete a group and projects become ungrouped', async () => {
    await createGroup(page, 'Temp');

    // Move Alpha to Temp via context menu
    await page.locator('text=Alpha').first().click({ button: 'right' });
    await page.locator('text=Temp').last().click();

    // Delete the group
    const groupHeader = page.locator('[data-testid^="project-group-"]');
    await groupHeader.hover();
    await page.locator('button[title="Delete group"]').click();

    // Confirm dialog
    await expect(page.getByRole('heading', { name: 'Delete Group' })).toBeVisible();
    await page.locator('button:has-text("Delete")').last().click();

    // Group header should be gone
    await expect(page.locator('[data-testid^="project-group-"]')).toBeHidden();

    // Alpha should still be visible (ungrouped)
    await expect(page.locator('text=Alpha').first()).toBeVisible();
  });

  test('context menu moves project to group', async () => {
    await createGroup(page, 'Dev');

    // Right-click Alpha to open context menu
    await page.locator('text=Alpha').first().click({ button: 'right' });

    // Click "Dev" in the context menu
    const contextMenu = page.locator('.fixed.bg-surface-raised');
    await expect(contextMenu).toBeVisible();
    await contextMenu.locator('text=Dev').click();

    // Alpha should now be indented (grouped)
    const alphaItem = page.locator('text=Alpha').first().locator('..');
    await expect(page.locator('text=Alpha').first()).toBeVisible();
  });

  test('context menu removes project from group', async () => {
    await createGroup(page, 'Team');

    // Move Alpha to Team
    await page.locator('text=Alpha').first().click({ button: 'right' });
    await page.locator('text=Team').last().click();

    // Right-click Alpha again to remove from group
    await page.locator('text=Alpha').first().click({ button: 'right' });
    const contextMenu = page.locator('.fixed.bg-surface-raised');
    await expect(contextMenu).toBeVisible();
    await contextMenu.locator('text=Remove from group').click();

    // Alpha is still visible (now ungrouped)
    await expect(page.locator('text=Alpha').first()).toBeVisible();
  });
});
