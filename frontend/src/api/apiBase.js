// Backend base URL. Empty in local dev (Vite proxies /api to localhost:8000). In production the frontend and
// backend are on different hosts, so set VITE_API_BASE_URL (e.g. https://api.example.com) at build time.
export const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/+$/, '')

// "/api/quiz" -> "https://api.example.com/api/quiz"; absolute URLs are left alone
export const withApiBase = (url, base = API_BASE) =>
  base && url.startsWith('/') ? `${base}${url}` : url
