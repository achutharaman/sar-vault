import { expect, test } from '@playwright/test';

/**
 * The Content-Security-Policy is a stated security control (SECURITY.md,
 * living-spec D-009), so it is asserted rather than assumed. A build that
 * silently drops or loosens it should fail here.
 */

/** Parse a policy into `directive -> sources`, so each can be checked in isolation. */
function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (name) directives.set(name, sources);
  }
  return directives;
}

test.describe('Content-Security-Policy', () => {
  test('is served and locked down', async ({ page }) => {
    await page.goto('/');

    const content = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');

    expect(content, 'CSP meta tag must be present').toBeTruthy();
    const csp = parsePolicy(content!.replace(/\s+/g, ' '));

    expect(csp.get('default-src')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'none'"]);
    expect(csp.get('form-action')).toEqual(["'none'"]);
    expect(csp.get('frame-src')).toEqual(["'none'"]);

    // Argon2id ships as WASM (Q-009) and cannot instantiate without this.
    // Checked against the script-src sources alone: style-src legitimately
    // carries 'unsafe-inline' (D-009), and a whole-string match would conflate
    // the two.
    const scriptSrc = csp.get('script-src');
    expect(scriptSrc).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");

    // The one deliberate concession (D-009), asserted so that widening it later
    // is a visible decision rather than a silent drift.
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);

    // Hard rule 2: the app talks to the user's storage provider and nothing
    // else. Until providers land in v0.2 this is 'self' only.
    expect(csp.get('connect-src')).toEqual(["'self'"]);
  });

  test('loads and bootstraps without CSP violations', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (/content security policy/i.test(text)) violations.push(text);
    });

    await page.goto('/');
    await expect(page.locator('app-root')).toBeAttached();

    expect(violations, `CSP violations at runtime:\n${violations.join('\n')}`).toEqual([]);
  });
});
