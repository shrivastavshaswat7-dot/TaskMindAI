// Where Supabase should send users back to after they click an emailed link (password reset, sign-up confirmation).
// The URL must be on Supabase's allow-list (Authentication -> URL Configuration -> Redirect URLs), otherwise Supabase
// ignores it and falls back to its "Site URL" (often still http://localhost:3000).
//
// - Production: set VITE_SITE_URL=https://<your-site> at build time. A fixed address avoids "random" Vercel deployment
//   or preview URLs that are not on the allow-list.
// - Local dev: leave VITE_SITE_URL unset; the page's own origin (e.g. http://localhost:5173) is used.
export const normalizeSiteUrl = (raw) => {
  const url = String(raw || '').trim().replace(/\/+$/, '')
  return url && !/^https?:\/\//i.test(url) ? `https://${url}` : url
}

export const SITE_URL = normalizeSiteUrl(import.meta.env?.VITE_SITE_URL)

// Always ends with "/" (the app handles the recovery link on "/", see App.jsx)
export const authRedirectUrl = (origin = window.location.origin, site = SITE_URL) =>
  `${String(site || origin).replace(/\/+$/, '')}/`
