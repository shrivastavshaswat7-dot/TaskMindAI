// What the page was opened with: the URL hash is read once, as soon as this module loads (App.jsx imports it
// before anything else), because the Supabase client rewrites the hash while it processes an emailed link.
import { parseAuthCallback } from './authMessages.js'

export const AUTH_LANDING = parseAuthCallback(typeof window === 'undefined' ? '' : window.location.hash)

// Upper limit for the "Finishing verification..." state on the login screen. Normally it ends in a fraction of a second
// (as soon as the temporary sign-out settles); this only guarantees the login button can never stay disabled forever.
export const VERIFY_SETTLE_TIMEOUT_MS = 6000

// A login must never run while the temporary verification sign-out is still in flight: when that sign-out finally
// finishes, Supabase removes whatever session is stored at that moment, including the one the login just created
// (signInWithPassword does not take the lock that signOut holds, so the two can interleave). So after the 6 s limit above
// has re-enabled the button, a click still waits here for the sign-out to settle, for at most this long.
export const VERIFY_LOGIN_WAIT_MS = 20000

// Something that can be waited on before it is resolved
export function createDeferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Resolves when `pending` settles (or rejects), or after `maxMs`, whichever comes first. No `pending`: resolves at once.
export function waitForSettled(pending, maxMs) {
  if (!pending) return Promise.resolve()
  let timer
  const limit = new Promise((done) => {
    timer = setTimeout(done, maxMs)
  })
  return Promise.race([pending.then(() => {}, () => {}), limit]).finally(() => clearTimeout(timer))
}

// One per page load: resolves when the temporary verification sign-out has settled (null if the page was not opened
// from a verification link). Login waits on it, see VERIFY_LOGIN_WAIT_MS.
export const VERIFICATION = AUTH_LANDING.kind === 'signup' ? createDeferred() : null

// Remove the tokens / error from the address bar so a refresh does not repeat the message or re-trigger anything
export const clearAuthHash = () => {
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
}
