import { expect, test } from '@playwright/test';

/** Create a vault and land in the editor for a new entry. */
async function openNewEntryEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a new vault instead' }).click();
  await page.getByLabel('Vault name').fill('v0.3');
  await page.getByLabel('Master password').fill('a sufficiently long master password');
  await page.getByRole('button', { name: 'Create vault' }).click();
  await page.getByRole('button', { name: 'New entry' }).click();
}

test.describe('v0.3 features', () => {
  test('one click generates from the default preset', async ({ page }) => {
    await openNewEntryEditor(page);

    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    // Default preset is "Strong (20)". Generated passwords are revealed so they
    // can be checked before saving.
    const value = await page.locator('#entry-password').inputValue();
    expect(value).toHaveLength(20);
    await expect(page.locator('#entry-password')).toHaveAttribute('type', 'text');
    await expect(page.getByText(/Generated with/)).toContainText('Strong (20)');
    await expect(page.getByText(/bits,/)).toBeVisible();
  });

  test('the dropdown generates from another preset', async ({ page }) => {
    await openNewEntryEditor(page);

    await page.getByRole('button', { name: /Change preset/ }).click();
    await page.getByRole('menuitemradio', { name: /Numeric PIN \(6\)/ }).click();

    await expect(page.locator('#entry-password')).toHaveValue(/^\d{6}$/);
    await expect(page.getByText(/Generated with/)).toContainText('Numeric PIN (6)');
    // Choosing an item closes the menu.
    await expect(page.getByRole('menuitemradio')).toHaveCount(0);
  });

  /*
   * The reported bug: choosing a preset generated with it once, then every
   * later press of Generate silently reverted to the default — which made the
   * dropdown look broken. The selection has to stick.
   */
  test('the chosen preset sticks across repeated Generate presses', async ({ page }) => {
    await openNewEntryEditor(page);

    await page.getByRole('button', { name: /Change preset/ }).click();
    await page.getByRole('menuitemradio', { name: /Numeric PIN \(6\)/ }).click();
    await expect(page.locator('#entry-password')).toHaveValue(/^\d{6}$/);

    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Generate', exact: true }).click();
      const value = await page.locator('#entry-password').inputValue();
      // Still a PIN every time, and a different one each time.
      expect(value).toMatch(/^\d{6}$/);
      seen.add(value);
    }
    expect(seen.size).toBeGreaterThan(1);

    await expect(page.getByText(/Generated with/)).toContainText('Numeric PIN (6)');
  });

  test('the selection resets to the default for each entry opened', async ({ page }) => {
    await openNewEntryEditor(page);

    // Choose a non-default preset and save the entry.
    await page.getByLabel('Title').fill('First');
    await page.getByRole('button', { name: /Change preset/ }).click();
    await page.getByRole('menuitemradio', { name: /Numeric PIN \(6\)/ }).click();
    await page.getByRole('button', { name: 'Add entry' }).click();

    // A fresh entry starts from the default again.
    await page.getByRole('button', { name: 'New entry' }).click();
    await expect(page.getByText(/Generate uses/)).toContainText('Strong (20)');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('#entry-password')).toHaveValue(/^.{20}$/);

    // And so does opening an existing entry.
    await page.getByRole('button', { name: /First/ }).click();
    await expect(page.getByText(/Generate uses/)).toContainText('Strong (20)');
  });

  test('the menu marks which preset is active and which is default', async ({ page }) => {
    await openNewEntryEditor(page);

    await page.getByRole('button', { name: /Change preset/ }).click();
    // Every preset is listed, so the user can switch back to the default too.
    await expect(page.getByRole('menuitemradio')).toHaveCount(4);
    await expect(page.getByRole('menuitemradio', { name: /Strong \(20\)/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await page.getByRole('menuitemradio', { name: /Long \(32\)/ }).click();
    await page.getByRole('button', { name: /Change preset/ }).click();
    await expect(page.getByRole('menuitemradio', { name: /Long \(32\)/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('presets are managed in settings, and the default is respected', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Presets');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Password presets' })).toBeVisible();

    // Promote the PIN preset to default.
    const pinRow = page.locator('.preset-list li', { hasText: 'Numeric PIN (6)' });
    await pinRow.getByRole('button', { name: 'Make default' }).click();
    await expect(pinRow.locator('.badge', { hasText: 'Default' })).toBeVisible();

    // The editor's one-click Generate now uses it.
    await page.getByRole('link', { name: 'Back to vault' }).click();
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('#entry-password')).toHaveValue(/^\d{6}$/);
  });

  test('a new preset appears in the dropdown', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Presets');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole('button', { name: 'Add preset' }).click();
    await page.locator('.preset-form').getByLabel('Name').fill('Tiny');
    await page.locator('.preset-form input[type=range]').fill('8');
    await page.getByRole('button', { name: 'Save preset' }).click();

    await expect(page.locator('.preset-list li', { hasText: 'Tiny' })).toBeVisible();
    // Custom presets are vault content, so the vault is now unsaved.
    await page.getByRole('link', { name: 'Back to vault' }).click();
    await expect(page.locator('.dirty')).toBeVisible();
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('link', { name: 'Back to vault' }).click();

    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByRole('button', { name: /Change preset/ }).click();
    await page.getByRole('menuitemradio', { name: /Tiny/ }).click();

    await expect(page.locator('#entry-password')).toHaveValue(/^.{8}$/);
  });

  test('an unusable preset cannot be saved', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Presets');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole('button', { name: 'Add preset' }).click();
    await page.locator('.preset-form').getByLabel('Name').fill('Impossible');

    // Turning every character class off leaves nothing to draw from.
    for (const label of ['a–z', 'A–Z', '0–9', 'Symbols']) {
      await page.locator('.preset-form').getByText(label, { exact: true }).click();
    }

    await expect(page.getByRole('alert')).toContainText('at least one character type');
    await expect(page.getByRole('button', { name: 'Save preset' })).toBeDisabled();
  });

  test('shows a live TOTP code from an otpauth URI', async ({ page }) => {
    await openNewEntryEditor(page);

    await page
      .locator('#entry-totp')
      .fill('otpauth://totp/GitHub:me?secret=MZXW6YTBOI&issuer=GitHub');

    // Six digits plus a countdown, computed by the RFC 6238 implementation.
    await expect(page.locator('.totp code')).toHaveText(/^\d{6}$/);
    await expect(page.locator('.totp-countdown')).toHaveText(/^\d+s$/);
  });

  test('reports a malformed TOTP secret without breaking the editor', async ({ page }) => {
    await openNewEntryEditor(page);

    await page.locator('#entry-totp').fill('otpauth://totp/X?secret=not-base32!!');

    await expect(page.getByRole('alert')).toContainText(/base32/i);
    // The rest of the form still works.
    await page.getByLabel('Title').fill('Still editable');
    await expect(page.getByLabel('Title')).toHaveValue('Still editable');
  });

  test('adds tags and custom fields, and they survive a save', async ({ page }) => {
    await openNewEntryEditor(page);

    await page.getByLabel('Title').fill('Tagged entry');
    await page.locator('#entry-tags').fill('work');
    await page.locator('#entry-tags').press('Enter');
    await expect(page.locator('.tags li')).toContainText('work');

    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel('Custom field 1 name').fill('Recovery');
    await page.getByLabel('Custom field 1 value').fill('abc-123');

    await page.getByRole('button', { name: 'Add entry' }).click();
    await page.getByRole('button', { name: /Tagged entry/ }).click();

    await expect(page.locator('.tags li')).toContainText('work');
    await expect(page.getByLabel('Custom field 1 name')).toHaveValue('Recovery');
  });

  test('imports a browser CSV export', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Import target');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();

    await page.setInputFiles('.import input[type=file]', {
      name: 'passwords.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'name,url,username,password\nGitHub,https://github.com,me,pw1\nEmail,https://mail.example,me2,pw2\n',
      ),
    });

    await expect(page.getByRole('status')).toContainText('Imported 2 entries');
    await expect(page.getByRole('button', { name: /GitHub/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Email/ })).toBeVisible();
  });

  test('refuses an unrecognised import instead of half-importing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Import target');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();

    await page.setInputFiles('.import input[type=file]', {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is just prose, not an export'),
    });

    await expect(page.getByRole('alert')).toContainText(/could not tell what kind of file/i);
    await expect(page.getByText('This vault has no entries yet.')).toBeVisible();
  });

  test('settings is a real page with its own URL', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Routing');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    // The vault view is gone, not merely covered.
    await expect(page.getByPlaceholder('Search entries')).toHaveCount(0);

    // Browser Back returns to the vault, which a collapsible panel could not do.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/settings$/);
    await expect(page.getByPlaceholder('Search entries')).toBeVisible();
  });

  test('locking from the settings page returns to the unlock screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Routing');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();

    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Lock automatically after').selectOption('1');

    // Reloading /settings while locked must land on the unlock screen, not on a
    // settings page for a vault that is no longer open.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'sar-vault' })).toBeVisible();
  });

  /*
   * The dropdown must show the timeout that is actually in force. Binding
   * [value] on the select rather than [selected] on the options showed "Never"
   * while auto-lock was on — a security control displaying the opposite of the
   * truth.
   */
  test('the auto-lock dropdown reflects the real setting', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Routing');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();
    await page.getByRole('link', { name: 'Settings' }).click();

    // Default is 15 minutes, and the countdown must agree with the dropdown.
    await expect(page.getByLabel('Lock automatically after')).toHaveValue('15');
    await expect(page.getByText(/Locking in \d+s/)).toBeVisible();

    await page.getByLabel('Lock automatically after').selectOption('0');
    await expect(page.getByText(/Auto-locking is off/)).toBeVisible();
    await expect(page.getByText(/Locking in \d+s/)).toHaveCount(0);

    // The choice survives leaving and returning to the page.
    await page.getByRole('link', { name: 'Back to vault' }).click();
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByLabel('Lock automatically after')).toHaveValue('0');
  });

  test('exposes an auto-lock setting', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Lockable');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByLabel('Lock automatically after')).toBeVisible();

    await page.getByLabel('Lock automatically after').selectOption('1');
    await expect(page.getByText(/Locking in \d+s/)).toBeVisible();
  });
});

test.describe('presets live in the vault', () => {
  /*
   * The save/lock/reopen round-trip is covered as a unit test
   * (generator-presets.service.spec.ts, "survives a save and reopen"), which
   * serialises and re-parses real KDBX bytes. It cannot be done here: in
   * Chromium the unlock screen uses the File System Access picker, which
   * Playwright cannot drive, so there is no file input to populate.
   *
   * What is asserted here is the part a unit test cannot see — that the UI
   * reflects vault-scoped presets correctly.
   */
  test('built-in presets cannot be edited or deleted', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Builtins');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();
    await page.getByRole('link', { name: 'Settings' }).click();

    const builtIn = page.locator('.preset-list li', { hasText: 'Strong (20)' });
    await expect(builtIn.locator('.badge', { hasText: 'Built-in' })).toBeVisible();
    await expect(builtIn.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(builtIn.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
    // Duplicating is how you customise one.
    await expect(builtIn.getByRole('button', { name: /Duplicate/ })).toBeVisible();
  });

  test('locking removes custom presets from the picker', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Locked');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();

    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Add preset' }).click();
    await page.locator('.preset-form').getByLabel('Name').fill('Only in this vault');
    await page.getByRole('button', { name: 'Save preset' }).click();
    await expect(page.locator('.preset-list li', { hasText: 'Only in this vault' })).toBeVisible();

    await page.getByRole('link', { name: 'Back to vault' }).click();
    await page.getByRole('button', { name: 'Lock' }).click();

    // A different vault must not inherit them.
    await page.getByRole('button', { name: 'Create a new vault instead' }).click();
    await page.getByLabel('Vault name').fill('Another');
    await page.getByLabel('Master password').fill('a sufficiently long master password');
    await page.getByRole('button', { name: 'Create vault' }).click();
    await page.getByRole('link', { name: 'Settings' }).click();

    await expect(page.locator('.preset-list li', { hasText: 'Only in this vault' })).toHaveCount(0);
    await expect(page.locator('.preset-list li')).toHaveCount(4);
  });
});
