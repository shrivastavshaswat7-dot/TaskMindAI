// MOCKED-backend browser tests (see support/mockBackend.js): token handling and expired sessions.
import { test, expect } from '@playwright/test'
import { installMockBackend, loginThroughUi } from './support/mockBackend.js'

const PDF = { name: 'pyq.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 mock') }

async function startExtract(page) {
  await page.getByRole('link', { name: /PYQ Analysis/ }).click()
  await page.locator('#pyq-subject').fill('Maths')
  await page.locator('input[type=file]').setInputFiles(PDF)
  await page.getByRole('button', { name: /Extract Topics/ }).click()
}

test('every API call carries the current session token', async ({ page }) => {
  const mock = await installMockBackend(page)
  await loginThroughUi(page)
  await startExtract(page)
  await expect(page.getByText('Saved to "Maths"')).toBeVisible()
  await page.getByRole('link', { name: /AI Assistant/ }).click()
  await page.getByPlaceholder(/Ask anything/).fill('hi')
  await page.locator('.chat-send-btn').click()
  await expect(page.getByText('Hello from the mocked assistant.')).toBeVisible()

  expect(mock.apiCalls.length).toBeGreaterThan(1)
  for (const call of mock.apiCalls) {
    expect(call.authorization, call.path).toBe('Bearer mock-access-token-1')
  }
})

test('an expired token is refreshed once and the request is retried transparently', async ({ page }) => {
  const mock = await installMockBackend(page)
  await loginThroughUi(page)
  await page.getByRole('link', { name: /PYQ Analysis/ }).click()

  mock.token = 'server-side-rotated-token'          // the access token the browser holds is now rejected
  await page.locator('#pyq-subject').fill('Maths')
  await page.locator('input[type=file]').setInputFiles(PDF)
  await page.getByRole('button', { name: /Extract Topics/ }).click()

  await expect(page.getByText('Saved to "Maths"')).toBeVisible()
  expect(mock.refreshCount).toBe(1)
  const calls = mock.apiCalls.filter((c) => c.path === '/api/extract')
  expect(calls).toHaveLength(2)                      // first rejected (401), then retried with the new token
  expect(calls[0].authorization).toBe('Bearer mock-access-token-1')
  expect(calls[1].authorization).toBe(`Bearer ${mock.token}`)
})

test('a session that cannot be refreshed returns the user to the login screen', async ({ page }) => {
  const mock = await installMockBackend(page, {
    tables: { tasks: [{ id: 't1', user_id: '11111111-1111-4111-8111-111111111111', title: 'Private task', completed: false, created_at: '2026-01-01T00:00:00Z' }] },
  })
  await loginThroughUi(page)
  await startExtract(page)
  await expect(page.getByText('Saved to "Maths"')).toBeVisible()

  mock.token = 'server-side-rotated-token'
  mock.refreshFails = true
  await page.getByRole('link', { name: /PYQ Analysis/ }).click()
  await page.locator('input[type=file]').setInputFiles(PDF)
  await page.getByRole('button', { name: /Extract Topics/ }).click()

  await expect(page.getByPlaceholder('Enter your email')).toBeVisible()       // back on the login screen
  await expect(page.getByText('Private task')).toHaveCount(0)
  await page.reload()
  await expect(page.getByPlaceholder('Enter your email')).toBeVisible()       // and the session is really gone
})
