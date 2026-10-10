// fetch() that sends the signed-in user's Supabase access token. The backend takes the user's identity
// from this token (never from a user_id in the request), so every /api call must go through here.
//
// Reliability: every request has a timeout (so a hung server can never leave a spinner on screen forever) and network
// failures become readable errors (ApiError with code 'network' / 'timeout'). The timeout covers the wait for the
// response headers only; a streaming body (the chat) is not cut off once it has started.
import { supabase } from '../supabase'
import { withApiBase } from './apiBase'
import { ApiError, describeNetworkFailure, errorFromResponse, readBody } from './errors'

// VITE_API_TIMEOUT_MS is optional (used by the browser tests); the default suits a free server that is waking up
export const DEFAULT_TIMEOUT_MS = Number(import.meta.env?.VITE_API_TIMEOUT_MS) || 90_000

export async function authHeaders(headers = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token
    ? { ...headers, Authorization: `Bearer ${session.access_token}` }
    : headers
}

export async function authFetch(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...init } = options

  const send = async () => {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const cancel = () => controller.abort()
    callerSignal?.addEventListener('abort', cancel)
    try {
      return await fetch(withApiBase(url), {
        ...init,
        headers: await authHeaders(init.headers || {}),
        signal: controller.signal,
      })
    } catch (err) {
      if (callerSignal?.aborted) throw err                       // the caller cancelled on purpose
      throw describeNetworkFailure(err, { timedOut, timeoutMs })
    } finally {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', cancel)
    }
  }

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

// JSON in, JSON out. Throws an ApiError with a readable message for network problems and for non-2xx answers.
export async function apiJson(url, options = {}) {
  const response = await authFetch(url, options)
  if (!response.ok) throw await errorFromResponse(response)
  return readBody(response)
}

export { ApiError }
