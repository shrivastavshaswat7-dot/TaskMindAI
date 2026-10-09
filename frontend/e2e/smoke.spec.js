// MOCKED-backend smoke tests for the rest of the app (see support/mockBackend.js). They show the pages render,
// basic actions work against the mocked backend and nothing logs a console error. Not real Supabase / Gemini.
import { test, expect } from '@playwright/test'
import { installMockBackend, loginThroughUi, USER } from './support/mockBackend.js'

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.mock = await installMockBackend(page)
  await loginThroughUi(page)
  await expect(page.getByText('STUDENT DASHBOARD')).toBeVisible()
})

test.afterEach(async ({}, testInfo) => { // eslint-disable-line no-empty-pattern
  expect(testInfo.mock.consoleErrors).toEqual([])
})

test('dashboard shows the greeting', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Test')
})

test('tasks: add a task', async ({ page }, testInfo) => {
  await page.getByRole('link', { name: /Tasks/ }).click()
  await expect(page.getByRole('heading', { name: 'Your Tasks' })).toBeVisible()
  await page.getByPlaceholder('Add a new task...').fill('Write lab report')
  await page.getByRole('button', { name: /Add/ }).first().click()
  await expect(page.getByText('Write lab report')).toBeVisible()
  expect(testInfo.mock.tables.tasks).toHaveLength(1)
  expect(testInfo.mock.tables.tasks[0].user_id).toBe(USER.id)
})

test('timetable and attendance pages render', async ({ page }) => {
  await page.getByRole('link', { name: /Timetable/ }).click()
  await expect(page.getByRole('heading', { name: 'Your Timetable' })).toBeVisible()
  await page.getByRole('link', { name: /Attendance/ }).click()
  await expect(page.getByRole('heading', { name: 'Your Attendance' })).toBeVisible()
})

test('AI assistant: chat reply is shown', async ({ page }) => {
  await page.getByRole('link', { name: /AI Assistant/ }).click()
  await page.getByPlaceholder(/Ask anything/).fill('Explain Laplace transforms')
  await page.locator('.chat-send-btn').click()
  await expect(page.getByText('Hello from the mocked assistant.')).toBeVisible()
})

test('documents: list, upload and ask a question', async ({ page }, testInfo) => {
  await page.getByRole('link', { name: /AI Assistant/ }).click()
  await page.getByRole('button', { name: /Documents/ }).click()
  await expect(page.locator('.doc-name', { hasText: 'notes.pdf' })).toBeVisible()

  await page.locator('input[type=file]').setInputFiles({ name: 'uploaded.txt', mimeType: 'text/plain', buffer: Buffer.from('hello notes') })
  await expect(page.locator('.doc-name', { hasText: 'uploaded.txt' })).toBeVisible()

  await page.getByPlaceholder(/main concept/).fill('What is in my notes?')
  await page.getByRole('button', { name: /Ask AI/ }).click()
  await expect(page.getByText('The mocked answer from your notes.')).toBeVisible()

  const calls = testInfo.mock.apiCalls.filter((c) => c.path.startsWith('/api/documents'))
  expect(calls.length).toBeGreaterThanOrEqual(3)
  for (const call of calls) expect(call.authorization).toBe('Bearer mock-access-token-1')
  // the client only ever names itself as the signed-in user
  const query = calls.find((c) => c.path === '/api/documents/query')
  expect(query.body.user_id).toBe(USER.id)
})

test('email assistant: draft a reply', async ({ page }) => {
  await page.getByRole('link', { name: /Email Assistant/ }).click()
  await page.getByPlaceholder(/Paste the email here/).fill('Please submit the assignment by Friday.')
  await page.getByRole('button', { name: /Generate Reply/ }).click()
  await expect(page.getByText('Dear Professor, thank you.')).toBeVisible()
})
