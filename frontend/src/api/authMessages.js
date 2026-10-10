// Pure helpers (no React, no Supabase) for the sign-up / email-verification flow: reading the URL hash Supabase
// redirects back with, and turning auth errors into messages a user can act on.

// Supabase sends the user back to the site with the result in the URL hash, e.g.
//   #access_token=...&type=signup                      verification link (Supabase also starts a session from it)
//   #access_token=...&type=recovery                    password-reset link
//   #error=access_denied&error_code=otp_expired&...    expired / already used / invalid link
export function parseAuthCallback(hash) {
  const raw = String(hash || '').replace(/^#/, '')
  if (!raw) return { kind: 'none' }
  const params = new URLSearchParams(raw)

  const error = params.get('error')
  const code = params.get('error_code')
  const description = params.get('error_description')
  if (error || code || description) {
    return { kind: 'error', code: code || error || '', description: description || '' }
  }

  const type = params.get('type')
  if (type === 'recovery') return { kind: 'recovery' }
  if (type === 'signup') return { kind: 'signup' }
  if (params.get('access_token')) return { kind: 'other' }
  return { kind: 'none' }
}

// Shown after every sign-up that needs email verification, whether the address is new or already registered.
// Supabase answers both the same way on purpose (no error, no session), so that nobody can use the sign-up form to find
// out which emails have accounts. Do not add wording here that depends on which case it was.
export const SIGNUP_NEUTRAL_MESSAGE = (email) =>
  `Almost there! If ${email} is not registered yet, we've sent it a verification link. Open it to verify your email, ` +
  'then log in here. If you already have an account, just log in or use "Forgot password".'

export const ACCOUNT_NOT_CREATED_MESSAGE =
  'We could not create this account. If you already have one, just log in or use "Forgot password".'

export const LINK_EXPIRED_MESSAGE =
  'This link has expired or was already used. If you already verified your email, just log in. ' +
  'Otherwise sign up again (or use "Forgot password") to get a new link.'

export function describeAuthError(error) {
  const code = String(error?.code || error?.error_code || '').toLowerCase()
  const message = String(error?.message || '')
  const lower = message.toLowerCase()

  if (code === 'email_not_confirmed' || lower.includes('email not confirmed')) {
    return "Your email isn't verified yet. Open the verification link we emailed you, then log in."
  }
  if (code === 'invalid_credentials' || lower.includes('invalid login credentials')) {
    return 'Incorrect email or password.'
  }
  if (code === 'user_already_exists' || code === 'email_exists' || lower.includes('already registered')) {
    return ACCOUNT_NOT_CREATED_MESSAGE   // when confirmation is off Supabase reports the duplicate; we stay neutral
  }
  if (code === 'weak_password') {
    return 'That password is too weak. Use at least 6 characters, ideally with letters and numbers.'
  }
  if (code === 'signup_disabled') return 'Sign-ups are currently turned off.'
  if (
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    error?.status === 429 ||
    lower.includes('rate limit')
  ) {
    return 'Too many attempts. Please wait a minute and try again.'
  }
  if (code === 'otp_expired' || lower.includes('expired')) return LINK_EXPIRED_MESSAGE
  if (lower.includes('failed to fetch') || lower.includes('network') || error?.name === 'AuthRetryableFetchError') {
    return "Can't reach the sign-in service. Check your connection and try again."
  }
  return message || 'Something went wrong. Please try again.'
}

// The notice to show on the login screen after the user comes back from an emailed link (or null)
export function landingNotice(callback) {
  if (callback?.kind === 'signup') {
    return { type: 'success', text: 'Email verified! Please log in to continue.' }
  }
  if (callback?.kind === 'error') {
    const expired = /otp_expired|expired/i.test(`${callback.code} ${callback.description}`)
    return { type: 'error', text: expired ? LINK_EXPIRED_MESSAGE : 'This link is not valid. Please request a new one.' }
  }
  return null
}
