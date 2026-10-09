// fetch() that sends the signed-in user's Supabase access token. The backend takes the user's identity
// from this token (never from a user_id in the request), so every /api call must go through here.
import { supabase } from '../supabase'
import { withApiBase } from './apiBase'

export async function authHeaders(headers = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token
    ? { ...headers, Authorization: `Bearer ${session.access_token}` }
    : headers
}

export async function authFetch(url, options = {}) {
  const send = async () =>
    fetch(withApiBase(url), { ...options, headers: await authHeaders(options.headers || {}) })

  const response = await send()
  if (response.status !== 401) return response

  // Token expired/invalid: refresh the session once and retry. If that fails the session is really over,
  // so sign out; App's auth listener then clears the user's data and shows the login screen.
  const { data, error } = await supabase.auth.refreshSession()
  if (!error && data?.session) {
    const retry = await send()
    if (retry.status !== 401) return retry
  }
  await supabase.auth.signOut()
  return response
}
