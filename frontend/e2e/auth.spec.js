// MOCKED-backend browser tests (see support/mockBackend.js). They verify the UI and session handling,
// not real Supabase.
import { test, expect } from '@playwright/test'
import { installMockBackend, loginThroughUi } from './support/mockBackend.js'

const loginForm = (page) => page.getByPlaceholder('Enter your email')

test('login, session survives a refresh, logout clears it', async ({ page }) => {
  const mock = await installMockBackend(page)
  await loginThroughUi(page)
  await expect(page.getByText('STUDENT DASHBOARD')).toBeVisible()

  await page.reload()
  await expect(page.getByText('STUDENT DASHBOARD')).toBeVisible()   // session restored from storage

  await page.getByRole('button', { name: /Logout/ }).click()
  await expect(loginForm(page)).toBeVisible()

  await page.reload()
  await expect(loginForm(page)).toBeVisible()                        // still logged out after refresh
  expect(mock.consoleErrors).toEqual([])
})

test('wrong credentials show an error and stay on the login screen', async ({ page }) => {
  const mock = await installMockBackend(page)
  mock.loginError = true
  await loginThroughUi(page)
  await expect(page.getByText('Incorrect email or password.')).toBeVisible()
  await expect(loginForm(page)).toBeVisible()
})

test('a visitor who is not logged in sees the login screen and no API traffic', async ({ page }) => {
  const mock = await installMockBackend(page)
  await page.goto('/pyq')
  await expect(loginForm(page)).toBeVisible()
  expect(mock.apiCalls).toEqual([])
})

test('logout removes the previous user data from the screen state', async ({ page }) => {
  const mock = await installMockBackend(page, {
    tables: { tasks: [{ id: 't1', user_id: '11111111-1111-4111-8111-111111111111', title: 'Secret task', completed: false, created_at: '2026-01-01T00:00:00Z' }] },
  })
  await loginThroughUi(page)
  await page.getByRole('link', { name: /Tasks/ }).click()
  await expect(page.getByText('Secret task')).toBeVisible()
  await page.getByRole('button', { name: /Logout/ }).click()
  await expect(loginForm(page)).toBeVisible()
  await expect(page.getByText('Secret task')).toHaveCount(0)
  expect(mock.consoleErrors).toEqual([])
})
