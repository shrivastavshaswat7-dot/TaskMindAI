// MOCKED-backend browser tests (see support/mockBackend.js) for: sign up -> email verification -> login page ->
// explicit login -> dashboard. The verification link is simulated by opening the URL Supabase redirects to. These
// tests verify the app's handling of Supabase's auth events and URL hash, not real Supabase or real emails.
import { test, expect } from '@playwright/test'
import { installMockBackend, loginThroughUi, USER } from './support/mockBackend.js'

const VERIFY_LINK =
  '/#access_token=mock-link-token&refresh_token=mock-link-refresh&expires_in=3600&token_type=bearer&type=signup'
const EXPIRED_LINK =
  '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
const RESET_LINK =
  '/#access_token=mock-link-token&refresh_token=mock-link-refresh&expires_in=3600&token_type=bearer&type=recovery'

const loginForm = (page) => page.getByPlaceholder('Enter your email')
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const loginButton = (page) => page.getByRole('button', { name: 'Login', exact: true })
const busyButton = (page) => page.getByRole('button', { name: 'Finishing verification…' })

// Replace the (mocked) Supabase logout endpoint, which is what the temporary verification sign-out calls.
// Registered after installMockBackend, so it wins. `behaviour`: a delay in ms, 'fail' or 'hang'.
async function controlLogout(page, behaviour) {
  await page.route(/\/auth\/v1\/logout/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (behaviour === 'fail') return route.abort('failed')
    if (behaviour === 'hang') return new Promise(() => {})                 // never answers
    await new Promise((resolve) => setTimeout(resolve, behaviour))
    return route.fulfill({ status: 204, headers: CORS })
  })
}
const dashboard = (page) => page.getByText('STUDENT DASHBOARD')

// Records (in the page) whether the dashboard was EVER rendered, so a brief flash would also fail a test
async function watchForDashboardFlash(page) {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.body && document.body.innerText.includes('STUDENT DASHBOARD')) window.__dashboardSeen = true
    }).observe(document, { childList: true, subtree: true })
  })
}
const dashboardEverShown = (page) => page.evaluate(() => Boolean(window.__dashboardSeen))
const storedSessions = (page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sb-') && k.includes('auth-token')))

async function signUp(page, { email = 'new.student@example.test', name = 'New Student' } = {}) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign Up' }).click()
  await page.getByPlaceholder(/full name|your name|name/i).first().fill(name)
  await page.getByPlaceholder('Enter your email').fill(email)
  await page.getByPlaceholder('Create a password').fill('a-test-password')
  await page.getByPlaceholder('Confirm your password').fill('a-test-password')
  await page.locator('button[type=submit]').click()
}

test('sign up asks for verification and sends the user to the login screen, not the dashboard', async ({ page }) => {
  const mock = await installMockBackend(page)
  await watchForDashboardFlash(page)
  await signUp(page)

  await expect(page.getByText(/If new\.student@example\.test is not registered yet, we've sent it a verification link/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()     // login screen
  await expect(loginForm(page)).toHaveValue('new.student@example.test')               // email carried over
  expect(await dashboardEverShown(page)).toBe(false)
  expect(await storedSessions(page)).toEqual([])
  expect(mock.signups).toHaveLength(1)
  expect(mock.signups[0].redirectTo).toMatch(/^http:\/\/localhost:5173\/?$/)           // authRedirectUrl() (local dev)
  expect(mock.consoleErrors).toEqual([])
})

test('the verification link lands on the login page and leaves NO session behind', async ({ page }) => {
  const mock = await installMockBackend(page)
  await watchForDashboardFlash(page)
  await page.goto(VERIFY_LINK)

  await expect(page.getByText('Email verified! Please log in to continue.')).toBeVisible()
  await expect(loginForm(page)).toBeVisible()
  await page.waitForTimeout(1500)                                  // give Supabase's delayed SIGNED_IN event time to arrive
  await expect(dashboard(page)).toHaveCount(0)
  expect(await dashboardEverShown(page)).toBe(false)               // not even a flash
  expect(await storedSessions(page)).toEqual([])                   // the temporary session was removed
  expect(page.url()).not.toContain('access_token')                 // tokens are gone from the address bar
  expect(mock.apiCalls).toEqual([])                                // nothing authenticated happened

  await page.reload()                                              // no redirect loop, still logged out
  await expect(loginForm(page)).toBeVisible()
  await expect(dashboard(page)).toHaveCount(0)
  expect(mock.consoleErrors).toEqual([])
})

test('after verifying, an explicit login opens the dashboard (and logging out clears the notice)', async ({ page }) => {
  const mock = await installMockBackend(page)
  await page.goto(VERIFY_LINK)
  await expect(page.getByText('Email verified! Please log in to continue.')).toBeVisible()

  await page.getByPlaceholder('Enter your email').fill(USER.email)
  await page.getByPlaceholder('Enter your password').fill('a-test-password')
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(dashboard(page)).toBeVisible()

  await page.getByRole('button', { name: /Logout/ }).click()
  await expect(loginForm(page)).toBeVisible()
  await expect(page.getByText('Email verified!')).toHaveCount(0)    // the notice is shown once, not after every logout

  // and auth events work normally again after the explicit login: a refresh restores the (new) session
  await loginThroughUi(page)
  await expect(dashboard(page)).toBeVisible()
  await page.reload()
  await expect(dashboard(page)).toBeVisible()
  expect(mock.consoleErrors).toEqual([])
})

test('an expired or already used verification link explains what to do', async ({ page }) => {
  const mock = await installMockBackend(page)
  await watchForDashboardFlash(page)
  await page.goto(EXPIRED_LINK)

  await expect(page.getByText(/expired or was already used/)).toBeVisible()
  await expect(page.getByText(/just log in/)).toBeVisible()
  await expect(loginForm(page)).toBeVisible()
  expect(await dashboardEverShown(page)).toBe(false)
  expect(page.url()).not.toContain('error_code')                    // cleaned, so a refresh does not repeat it
  await page.reload()
  await expect(page.getByText(/expired or was already used/)).toHaveCount(0)
  await expect(loginForm(page)).toBeVisible()
  expect(mock.consoleErrors).toEqual([])
})

test('signing up with an existing email gets the SAME neutral answer as a new one (no account enumeration)', async ({ browser }) => {
  const messageFor = async (signupMode, email) => {
    const page = await (await browser.newContext()).newPage()
    const mock = await installMockBackend(page)
    mock.signupMode = signupMode
    await signUp(page, { email })
    const notice = page.locator('.auth-message')
    await expect(notice).toBeVisible()
    const text = (await notice.innerText()).replaceAll(email, '<email>')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()       // same screen in both cases
    expect(await dashboardEverShown(page)).toBe(false)
    await page.close()
    return text
  }
  const forNewAddress = await messageFor('confirm', 'brand.new@example.test')
  const forExistingAddress = await messageFor('duplicate', 'taken@example.test')

  expect(forExistingAddress).toBe(forNewAddress)                                         // indistinguishable
  expect(forExistingAddress).not.toMatch(/already (exists|registered|taken|in use)/i)    // never confirms an account
  expect(forExistingAddress).not.toMatch(/account created/i)
  expect(forExistingAddress).toMatch(/If <email> is not registered yet/)
  expect(forExistingAddress).toMatch(/Forgot password/)
})

test('signing up when email confirmation is switched off still logs the user in', async ({ page }) => {
  const mock = await installMockBackend(page)
  mock.signupMode = 'immediate'
  await signUp(page)
  await expect(dashboard(page)).toBeVisible()
})

test('login with the wrong password shows a clear message', async ({ page }) => {
  const mock = await installMockBackend(page)
  mock.loginErrorCode = 'invalid_credentials'
  await loginThroughUi(page)
  await expect(page.getByText('Incorrect email or password.')).toBeVisible()
  await expect(dashboard(page)).toHaveCount(0)
})

test('login before verifying the email says the email is not verified yet', async ({ page }) => {
  const mock = await installMockBackend(page)
  mock.loginErrorCode = 'email_not_confirmed'
  await loginThroughUi(page)
  await expect(page.getByText(/isn't verified yet/)).toBeVisible()
  await expect(dashboard(page)).toHaveCount(0)
})

test('the password-reset link still opens the "Set new password" screen (not the dashboard, not the verify flow)', async ({ page }) => {
  const mock = await installMockBackend(page)
  await watchForDashboardFlash(page)
  await page.goto(RESET_LINK)
  await expect(page.getByRole('heading', { name: 'Set new password' })).toBeVisible()
  await page.waitForTimeout(1000)
  await expect(page.getByRole('heading', { name: 'Set new password' })).toBeVisible()
  expect(await dashboardEverShown(page)).toBe(false)
  await expect(page.getByText('Email verified!')).toHaveCount(0)
  expect(mock.consoleErrors).toEqual([])
})

// ---- the temporary verification sign-out vs. an explicit login ---------------------------------------------------
// Supabase's sign-out is a server call that, when it finishes, removes the stored session. A login that completed while
// it was still pending would have its brand-new session removed. So login must wait until the sign-out has settled.

test('login waits for a slow temporary sign-out, and the session of that login survives a reload', async ({ page }) => {
  const mock = await installMockBackend(page)
  await controlLogout(page, 2500)                                   // slow network: the temporary sign-out takes 2.5 s
  await page.goto(VERIFY_LINK)

  // during the delay: clearly pending, cannot be submitted by button or by pressing Enter
  await expect(busyButton(page)).toBeDisabled()
  await page.getByPlaceholder('Enter your email').fill(USER.email)
  await page.getByPlaceholder('Enter your password').fill('a-test-password')
  await busyButton(page).click({ force: true })                     // attempt to click the disabled button
  await page.getByPlaceholder('Enter your password').press('Enter') // attempt to submit with the keyboard
  await page.waitForTimeout(600)
  expect(mock.passwordLogins).toBe(0)                               // no login request was sent
  await expect(dashboard(page)).toHaveCount(0)

  // after the sign-out settles the button is a normal Login button again
  await expect(loginButton(page)).toBeEnabled({ timeout: 10_000 })
  await loginButton(page).click()
  await expect(dashboard(page)).toBeVisible()
  await page.waitForTimeout(500)
  expect(mock.passwordLogins).toBe(1)
  expect(await storedSessions(page)).toHaveLength(1)

  await page.reload()                                               // the eventual session survives
  await expect(dashboard(page)).toBeVisible()
  expect(await storedSessions(page)).toHaveLength(1)
  expect(mock.consoleErrors.filter((e) => !/net::ERR|Failed to load resource/.test(e))).toEqual([])
})

test('a sign-out that finishes AFTER the 6 s safety limit cannot remove the session of a later login', async ({ page }) => {
  const mock = await installMockBackend(page)
  await controlLogout(page, 9000)                                   // slower than the 6 s limit: the button gets enabled while it is still pending
  await page.goto(VERIFY_LINK)

  await expect(busyButton(page)).toBeDisabled()
  await expect(loginButton(page)).toBeEnabled({ timeout: 10_000 }) // the safety limit has passed, the sign-out has NOT finished yet
  await page.getByPlaceholder('Enter your email').fill(USER.email)
  await page.getByPlaceholder('Enter your password').fill('a-test-password')
  await loginButton(page).click()

  // the login queues behind the pending sign-out instead of racing it
  await page.waitForTimeout(1200)
  expect(mock.passwordLogins).toBe(0)
  await expect(dashboard(page)).toHaveCount(0)

  await expect(dashboard(page)).toBeVisible({ timeout: 15_000 })   // sign-out settled (~9 s), then the login went through
  await page.waitForTimeout(800)
  expect(mock.passwordLogins).toBe(1)
  expect(await storedSessions(page)).toHaveLength(1)               // the late sign-out did not delete this login's session

  await page.reload()
  await expect(dashboard(page)).toBeVisible()                      // and it survives a reload
  expect(await storedSessions(page)).toHaveLength(1)
})

test('if the temporary sign-out FAILS, the login button is enabled again and no session is left behind', async ({ page }) => {
  const mock = await installMockBackend(page)
  await controlLogout(page, 'fail')
  await page.goto(VERIFY_LINK)

  await expect(loginButton(page)).toBeEnabled({ timeout: 5000 })    // pending state ended, not stuck
  expect(await storedSessions(page)).toEqual([])                    // Supabase still removed the local session
  await expect(dashboard(page)).toHaveCount(0)

  await page.getByPlaceholder('Enter your email').fill(USER.email)
  await page.getByPlaceholder('Enter your password').fill('a-test-password')
  await loginButton(page).click()
  await expect(dashboard(page)).toBeVisible()
  expect(mock.passwordLogins).toBe(1)
})

test('if the temporary sign-out HANGS, the login button is enabled again after a safety limit', async ({ page }) => {
  await installMockBackend(page)
  await controlLogout(page, 'hang')
  await page.goto(VERIFY_LINK)

  await expect(busyButton(page)).toBeDisabled()
  await expect(loginButton(page)).toBeEnabled({ timeout: 10_000 }) // 6 s safety limit: never disabled indefinitely
  await expect(dashboard(page)).toHaveCount(0)
})

test('a normal login screen (no verification link) is never disabled', async ({ page }) => {
  await installMockBackend(page)
  await page.goto('/')
  await expect(loginButton(page)).toBeEnabled()
  await expect(busyButton(page)).toHaveCount(0)
})
