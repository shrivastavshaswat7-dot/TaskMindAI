import { defineConfig } from '@playwright/test'

// Browser tests use the Microsoft Edge that is already installed on the machine (no browser download).
// To use Chrome instead: BROWSER_CHANNEL=chrome npm run test:e2e
// All backend traffic (Supabase + /api) is mocked in e2e/support/mockBackend.js.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  // One intermittent failure (not yet identified) was seen on first runs. A retry keeps the suite usable, and
  // Playwright still lists the test as "flaky" and keeps its trace, so it is not hidden.
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
