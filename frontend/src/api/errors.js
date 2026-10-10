// Shared handling of failed API calls: one place that turns "something went wrong" into a message the user can act on.
// Pure (no React, no Supabase), so it is unit tested.

export class ApiError extends Error {
  // code: 'network' (could not reach the server) | 'timeout' | 'http' (the server answered with an error)
  constructor(message, { status = 0, code = 'http' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export const NETWORK_MESSAGE =
  'Could not reach the server. If it has been idle it may be waking up (this can take up to a minute). Please try again.'

export const timeoutMessage = (ms) =>
  `The server took too long to respond (over ${Math.round(ms / 1000)} seconds). It may be busy or waking up, so please try again.`

// What to tell the user for an HTTP status. `detail` is the server's own message (FastAPI sends { detail }) and wins when
// it is a plain string; validation errors (a list) and HTML error pages from a proxy never reach the user as raw text.
export function messageForStatus(status, detail) {
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  switch (status) {
    case 400:
    case 422:
      return 'The request was not valid. Please check what you entered and try again.'
    case 401:
      return 'Your session has expired. Please log in again.'
    case 403:
      return 'You do not have access to this.'
    case 404:
      return 'This could not be found.'
    case 413:
      return 'That file is too large.'
    case 429:
      return 'Too many requests. Please wait a minute and try again.'
    case 502:
    case 503:
    case 504:
      return 'The server is busy or waking up. Please try again in a moment.'
    default:
      return status >= 500 ? 'Something went wrong on the server. Please try again.' : `Request failed (${status}).`
  }
}

// fetch() itself failed: no HTTP answer at all (offline, DNS, CORS, server down) or our own timeout fired
export function describeNetworkFailure(err, { timedOut = false, timeoutMs = 0 } = {}) {
  if (timedOut) return new ApiError(timeoutMessage(timeoutMs), { code: 'timeout' })
  return new ApiError(NETWORK_MESSAGE, { code: 'network' })
}

// The response body as JSON, or {} when it is empty / not JSON (e.g. an HTML error page): never throws
export async function readBody(response) {
  try {
    return (await response.json()) ?? {}
  } catch {
    return {}
  }
}

export async function errorFromResponse(response) {
  const body = await readBody(response)
  return new ApiError(messageForStatus(response.status, body?.detail), { status: response.status, code: 'http' })
}

// Message for any error thrown by an API call, for the places that only show text
export const userMessage = (err) => (err && err.message) || 'Something went wrong. Please try again.'
