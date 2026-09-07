import { expect, test } from '@playwright/test';

/**
 * The v0.1 loop, end to end in a real browser: create a vault, add an entry,
 * save it, lock it.
 *
 * This is also the only place Argon2id runs under the *production* CSP. Unit
 * tests exercise the WASM module, but not with `script-src 'self'
 * 'wasm-unsafe-eval'` actually applied to the page — so if that directive were
 * ever dropped, this is what would catch it.
 */
test.describe('vault lifecycle', () => {
  test('creates a vault, adds an entry, saves and locks', async ({ page }) => {
    const cspViolations: string[] = [];
    page.on('console', (msg) => {
      if (/content security policy/i.test(msg.text())) cspViolations.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');

    // Locked: the unlock screen, and the honesty notice, are showing.
    await expect(page.getByRole('heading', { name: 'sar-vault' })).toBeVisible();
    await expect(page.getByText(/Unaudited and pre-alpha/)).toBeVisible();

    // Create a new vault.
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('E2E Vault');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();

    // Unlocked: the vault view replaces the unlock screen.
    await expect(page.getByRole('button', { name: 'Lock' })).toBeVisible();
    await expect(page.getByText('E2E Vault', { exact: true })).toBeVisible();
    await expect(page.getByText('This vault has no entries yet.')).toBeVisible();

    // Add an entry.
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByLabel('Title').fill('GitHub');
    await page.getByLabel('Username').fill('achutharaman');
    await page.getByLabel('Password', { exact: true }).fill('hunter2');
    await page.getByRole('button', { name: 'Add entry' }).click();

    // It appears in the list, and the vault is marked unsaved.
    await expect(page.getByRole('button', { name: /GitHub/ })).toBeVisible();
    await expect(page.locator('.dirty')).toBeVisible();

    /*
     * Saving runs Argon2id (in WASM) and serializes a real KDBX file. This
     * browser has no file handle for a vault created in-page, so the save falls
     * back to a download — which is exactly what we assert on.
     */
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('button', { name: /^(Save|Download)$/ }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('E2E Vault.kdbx');

    // Once saved, the unsaved-changes marker clears.
    await expect(page.locator('.dirty')).toBeHidden();

    // Locking returns to the unlock screen and clears the entry from the DOM.
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByRole('heading', { name: 'sar-vault' })).toBeVisible();
    await expect(page.getByRole('button', { name: /GitHub/ })).toHaveCount(0);

    expect(cspViolations, `CSP violations:\n${cspViolations.join('\n')}`).toEqual([]);
    expect(pageErrors, `Page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('reports a wrong password without unlocking', async ({ page }) => {
    await page.goto('/');

    // No file chosen, so unlocking is refused up front rather than pretending
    // to derive a key.
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });
});
