// OPT-IN test against REAL Supabase and the REAL backend (no mocks). It is skipped unless a dedicated TEST account
// is provided, and it has not been run by the authors yet because no such account is configured.
//
//   Use a throw-away test account (email login, no MFA), never a real user's credentials. Start the normal backend
//   (`uvicorn main:app --port 8000`) and frontend (`npm run dev`) first, then from frontend/:
//     PowerShell:  $env:E2E_REAL_EMAIL="test@example.com"; $env:E2E_REAL_PASSWORD="..."; npx playwright test e2e/real-login.spec.js
//     bash:        E2E_REAL_EMAIL=test@example.com E2E_REAL_PASSWORD=... npx playwright test e2e/real-login.spec.js
//
// It never prints the credentials or the access token. It only reads data (list of the account's own documents).
import { test, expect } from '@playwright/test'

const EMAIL = process.env.E2E_REAL_EMAIL
const PASSWORD = process.env.E2E_REAL_PASSWORD

test.skip(!EMAIL || !PASSWORD, 'Set E2E_REAL_EMAIL and E2E_REAL_PASSWORD (dedicated test account) to run the real-login test')

async function login(page) {
  await page.goto('/')
  await page.getByPlaceholder('Enter your email').fill(EMAIL)
  await page.getByPlaceholder('Enter your password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page.getByText('STUDENT DASHBOARD')).toBeVisible({ timeout: 20_000 })
}

test('real login, session survives a refresh, authenticated API works, other users are refused, logout', async ({ page }) => {
  await login(page)

  await page.reload()
  await expect(page.getByText('STUDENT DASHBOARD')).toBeVisible()           // session persisted

  // The app's own authenticated call: the document list for the signed-in user must be allowed (200)
  const listed = page.waitForResponse((r) => r.url().includes('/api/documents/list/'))
  await page.getByRole('link', { name: /AI Assistant/ }).click()
  await page.getByRole('button', { name: /Documents/ }).click()
  expect((await listed).status()).toBe(200)

  // Same endpoint for someone else's id must be refused (403), and without a token must be 401
  const results = await page.evaluate(async () => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    const token = JSON.parse(localStorage.getItem(key)).access_token
    const other = '00000000-0000-4000-8000-000000000000'
    const withToken = await fetch(`/api/documents/list/${other}`, { headers: { Authorization: `Bearer ${token}` } })
    const noToken = await fetch(`/api/documents/list/${other}`)
    const quizNoToken = await fetch('/api/quiz', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    return [withToken.status, noToken.status, quizNoToken.status]
  })
  expect(results).toEqual([403, 401, 401])

  await page.getByRole('button', { name: /Logout/ }).click()
  await expect(page.getByPlaceholder('Enter your email')).toBeVisible()
  await page.reload()
  await expect(page.getByPlaceholder('Enter your email')).toBeVisible()      // logged out for real
})
