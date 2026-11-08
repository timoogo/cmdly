import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://127.0.0.1:4378',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CMDLY_CHROMIUM_PATH ? { executablePath: process.env.CMDLY_CHROMIUM_PATH } : {},
  },
  webServer: [
    { command: 'PORT=4378 pnpm start', url: 'http://127.0.0.1:4378', reuseExistingServer: false, timeout: 30000 },
    { command: 'pnpm --filter playground exec vite preview --host 127.0.0.1 --port 4380 --strictPort', url: 'http://127.0.0.1:4380', reuseExistingServer: false, timeout: 30000 },
  ],
});
