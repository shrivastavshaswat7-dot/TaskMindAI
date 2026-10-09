// Backend base URL. Empty in local dev (Vite proxies /api to localhost:8000). In production the frontend and
// backend are on different hosts, so set VITE_API_BASE_URL (e.g. https://api.example.com) at build time.
// Tolerates spaces, a trailing slash and a missing scheme ("api.example.com" -> "https://api.example.com"),
// because a bare host would otherwise turn every API call into a request to the frontend's own host.
export const normalizeApiBase = (raw) => {
  const base = String(raw || '').trim().replace(/\/+$/, '')
  return base && !/^https?:\/\//i.test(base) ? `https://${base}` : base
}

export const API_BASE = normalizeApiBase(import.meta.env?.VITE_API_BASE_URL)

// "/api/quiz" -> "https://api.example.com/api/quiz"; absolute URLs are left alone
export const withApiBase = (url, base = API_BASE) =>
  base && url.startsWith('/') ? `${base}${url}` : url
