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
  return fetch(withApiBase(url), { ...options, headers: await authHeaders(options.headers || {}) })
}
