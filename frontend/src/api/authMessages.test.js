import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCOUNT_NOT_CREATED_MESSAGE,
  LINK_EXPIRED_MESSAGE,
  SIGNUP_NEUTRAL_MESSAGE,
  describeAuthError,
  landingNotice,
  parseAuthCallback,
} from './authMessages.js'

test('parseAuthCallback recognises a verification link, a reset link and an expired link', () => {
  assert.deepEqual(parseAuthCallback('#access_token=a&refresh_token=b&expires_in=3600&type=signup'), { kind: 'signup' })
  assert.deepEqual(parseAuthCallback('#access_token=a&type=recovery'), { kind: 'recovery' })
  assert.deepEqual(
    parseAuthCallback('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'),
    { kind: 'error', code: 'otp_expired', description: 'Email link is invalid or has expired' },
  )
})

test('parseAuthCallback ignores ordinary URLs and other token types', () => {
  assert.deepEqual(parseAuthCallback(''), { kind: 'none' })
  assert.deepEqual(parseAuthCallback(undefined), { kind: 'none' })
  assert.deepEqual(parseAuthCallback('#section-2'), { kind: 'none' })
  assert.deepEqual(parseAuthCallback('#access_token=a&type=magiclink'), { kind: 'other' })
})

test('the sign-up message does not reveal whether the email already has an account', () => {
  const text = SIGNUP_NEUTRAL_MESSAGE('a@example.com')
  assert.match(text, /a@example\.com/)
  assert.match(text, /If .* is not registered yet/)
  assert.match(text, /Forgot password/)
  // wording that would confirm an existing account must never appear
  assert.doesNotMatch(text, /already (exists|registered|taken|in use)/i)
  assert.doesNotMatch(text, /account (exists|created)/i)
  assert.doesNotMatch(ACCOUNT_NOT_CREATED_MESSAGE, /already (exists|registered|taken|in use)/i)
})

test('describeAuthError gives a clear message for each login/sign-up problem', () => {
  assert.match(describeAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' }), /Incorrect email or password/)
  assert.match(describeAuthError({ message: 'Invalid login credentials' }), /Incorrect email or password/)
  assert.match(describeAuthError({ code: 'email_not_confirmed', message: 'Email not confirmed' }), /isn't verified yet/)
  assert.equal(describeAuthError({ message: 'User already registered' }), ACCOUNT_NOT_CREATED_MESSAGE)
  assert.equal(describeAuthError({ code: 'user_already_exists' }), ACCOUNT_NOT_CREATED_MESSAGE)
  assert.match(describeAuthError({ code: 'weak_password' }), /too weak/)
  assert.match(describeAuthError({ status: 429, message: 'x' }), /Too many attempts/)
  assert.match(describeAuthError({ code: 'over_email_send_rate_limit' }), /Too many attempts/)
  assert.equal(describeAuthError({ code: 'otp_expired' }), LINK_EXPIRED_MESSAGE)
  assert.match(describeAuthError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }), /Can't reach/)
})

test('describeAuthError never returns an empty message', () => {
  assert.match(describeAuthError({}), /Something went wrong/)
  assert.match(describeAuthError(null), /Something went wrong/)
  assert.equal(describeAuthError({ message: 'Some other server message' }), 'Some other server message')
})

test('landingNotice: verified email asks for an explicit login, expired link explains itself', () => {
  assert.deepEqual(landingNotice({ kind: 'signup' }), { type: 'success', text: 'Email verified! Please log in to continue.' })
  assert.equal(landingNotice({ kind: 'error', code: 'otp_expired', description: '' }).text, LINK_EXPIRED_MESSAGE)
  assert.equal(landingNotice({ kind: 'error', code: 'access_denied', description: 'Email link has expired' }).type, 'error')
  assert.match(landingNotice({ kind: 'error', code: 'weird', description: 'nope' }).text, /not valid/)
  assert.equal(landingNotice({ kind: 'recovery' }), null)       // password reset keeps its own screen
  assert.equal(landingNotice({ kind: 'none' }), null)
})
