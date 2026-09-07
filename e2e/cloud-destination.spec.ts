import { expect, test } from '@playwright/test';

/**
 * The destination chooser on the create-vault form.
 *
 * Without OAuth client IDs configured no provider is available, so this asserts
 * the *unconfigured* behaviour: the app degrades to local files and says so,
 * rather than showing a button that cannot work. The connected path needs real
 * credentials and is covered by unit tests at the service/provider seam.
 */
test.describe('new vault destination', () => {
  test('degrades to local storage when no provider is configured', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();

    // No cloud buttons, and an explanation instead of a dead control.
    await expect(page.getByRole('button', { name: 'Google Drive' })).toHaveCount(0);
    await expect(page.getByText(/Connect Google Drive or OneDrive above/)).toBeVisible();

    // Creating still works, and saving still produces a file.
    await page.getByLabel('Vault name').fill('Local Only');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();

    await expect(page.getByRole('button', { name: 'Lock' })).toBeVisible();

    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('button', { name: /^(Save|Download)$/ }).click();
    expect((await download).suggestedFilename()).toBe('Local Only.kdbx');
  });
});
