import { defineConfig } from '@playwright/test'

// Browser tests use the Microsoft Edge that is already installed on the machine (no browser download).
// To use Chrome instead: BROWSER_CHANNEL=chrome npm run test:e2e
// All backend traffic (Supabase + /api) is mocked in e2e/support/mockBackend.js.
//
// The tests run against their own dev server on port 5199 (so they never collide with `npm run dev` on 5173), started with
// a short API timeout (VITE_API_TIMEOUT_MS) so the "server never answers" tests finish in seconds.
const PORT = 5199

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  // One intermittent failure was seen: the browser reported net::ERR_NETWORK_IO_SUSPENDED, Vite's client lost its
  // connection and reloaded the page in the middle of the login, which emptied the form. That is the machine/browser
  // suspending network IO, not an app bug. A retry keeps the suite usable, and Playwright still lists such a test as
  // "flaky" and keeps its trace, so it is not hidden.
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_API_TIMEOUT_MS: process.env.VITE_API_TIMEOUT_MS || '3000' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
