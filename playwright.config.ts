import { defineConfig, devices } from '@playwright/test';

/**
 * E2E configuration. See docs/living-spec.md.
 *
 * `chromium-headless-shell` is used rather than full Chromium: it is the lighter
 * binary and avoids the NSS/ALSA shared libraries that full Chromium needs via
 * `playwright install --with-deps` (which requires root).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { channel: 'chromium-headless-shell' },
      },
    },
  ],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
