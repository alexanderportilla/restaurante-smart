import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: './e2e-results/artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: './e2e-results/html-report', open: 'never' }],
    ['json', { outputFile: './e2e-results/results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:13000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
    launchOptions: {
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: [
    {
      command: '../backend/.venv/bin/python ./e2e/run-isolated-backend.py',
      url: 'http://127.0.0.1:18000/api/v1/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npx vite --config ./vite.e2e.config.ts',
      url: 'http://127.0.0.1:13000/login',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
