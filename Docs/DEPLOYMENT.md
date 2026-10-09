# Deploying TaskMindAI

**Status: nothing has been deployed.** This guide and `render.yaml` are prepared and checked locally, but they have not been
run against any hosting provider (no account or CLI was available). Treat the first real deployment as untested.

## Recommended setup: Render (one account, one file)

TaskMindAI is a static React/Vite frontend, a FastAPI backend, and Supabase (already hosted). The simplest fit is Render, because
the repo's `render.yaml` Blueprint creates both the backend (Python web service) and the frontend (static site) in one step.

| Option | Cost | Notes |
|---|---|---|
| **Render Blueprint (recommended)** | Free tier available | One dashboard and one file. **Free web services sleep after ~15 minutes idle; the first request then takes ~30-60 s.** Warm it up before a demo (see below) or use a paid instance (~$7/month, needs your approval) |
| Frontend on Netlify / Vercel / Cloudflare Pages, backend on Render | Free tier | Same backend steps. SPA fallback files for these hosts are already included: `frontend/public/_redirects` (Netlify, Cloudflare Pages) and `frontend/vercel.json` |
| Fly.io / Railway for the backend | Usually needs a card | Not prepared; the start command below works anywhere |

## What is prepared in the repo

- `render.yaml`: both services, health check `/api/health`, SPA rewrite, `APP_ENV=production`, and every secret declared with
  `sync: false` (Render asks for the value; nothing is stored in git).
- `frontend/public/_redirects`, `frontend/vercel.json`: SPA fallback (the app uses `BrowserRouter`, so `/priorities` must serve `index.html`).
- `backend/.env.example`, `frontend/.env.example`: placeholders for every variable.
- Production behaviour (tested): with `APP_ENV=production` the `/docs`, `/redoc` and `/openapi.json` pages are hidden, only the
  configured frontend origin is allowed by CORS (no localhost, no wildcard), the direct password reset stays disabled, and every API
  except `/api/health` requires a valid login token.

## Environment variables

**Backend (secrets: set in the host's dashboard only)**

| Variable | Required | Value |
|---|---|---|
| `GEMINI_API_KEY` | yes | Google AI Studio key |
| `SUPABASE_URL` | yes | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | yes | Service-role key. Server only |
| `EXTRA_ALLOWED_ORIGINS` | yes | The frontend URL, e.g. `https://taskmindai-web.onrender.com` (no trailing slash) |
| `APP_ENV` | yes | `production` (set by `render.yaml`) |
| `AI_RATE_LIMIT_PER_MINUTE` | no | Default 30 |
| `ALLOW_DIRECT_PASSWORD_RESET` | **never set** | Insecure, local development only |

**Frontend (public: these end up in the browser bundle, and are set at build time)**

| Variable | Required | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Same project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | The public anon/publishable key. **Never the service-role key** |
| `VITE_API_BASE_URL` | yes | The backend URL, e.g. `https://taskmindai-api.onrender.com` (no trailing slash) |
| `VITE_ENABLE_INSTANT_RESET` | **never set** | Shows the insecure reset tab |

## Steps

1. **Render:** sign up, then *New -> Blueprint*, connect this GitHub repo, select `main`. Render reads `render.yaml` and asks for the
   seven `sync: false` values.
2. **URLs depend on each other.** Create the two services first (you may enter the real project values for the secrets and a
   placeholder for the two URL variables), note the two `onrender.com` addresses, then set
   `EXTRA_ALLOWED_ORIGINS` (backend) to the frontend address and `VITE_API_BASE_URL` (frontend) to the backend address.
   Redeploy **both**: the backend to pick up CORS, the frontend because Vite embeds `VITE_*` values at build time.
3. **Supabase dashboard -> Authentication -> URL Configuration:** set *Site URL* to the frontend address and add it (with `/**`)
   to *Redirect URLs*; configure SMTP so reset emails are sent. Without this the password-reset link goes to the wrong place.
4. **Check the deployment** (replace the hosts):
   ```bash
   curl https://<api>/api/health                                   # 200
   curl -o /dev/null -w "%{http_code}\n" https://<api>/docs         # 404 (hidden in production)
   curl -o /dev/null -w "%{http_code}\n" -X POST https://<api>/api/quiz -H "Content-Type: application/json" -d "{}"   # 401
   curl -o /dev/null -w "%{http_code}\n" https://<web>/priorities   # 200 (SPA fallback)
   ```
   Then open the frontend, log in, and run the demo script in `Docs/HACKATHON_DEMO.md`. Optionally run the real-login test there
   against the deployed URLs with a dedicated test account.
5. **Before a demo:** open `https://<api>/api/health` a minute earlier so the free instance is awake.

## Security checklist before going public

- [ ] `SUPABASE_SERVICE_KEY` and `GEMINI_API_KEY` exist only as backend environment variables (not in the repo, not in any `VITE_*` variable).
- [ ] `ALLOW_DIRECT_PASSWORD_RESET` and `VITE_ENABLE_INSTANT_RESET` are not set.
- [ ] `EXTRA_ALLOWED_ORIGINS` is the real frontend URL only.
- [ ] The two-user isolation SQL in `Docs/HACKATHON_DEMO.md` has been run in Supabase (still **not verified**).
- [ ] One real login has been done on the deployed site.
- [ ] Supabase SMTP is set up if you want users to be able to reset passwords.

## Known limits of this setup

- The rate limiter is in memory per process: it resets on restart and is not shared if you run several instances.
- Uploads are handled in memory (10 MB cap), so no persistent disk is needed.
- Free instances sleep when idle (cold start). Gemini calls still depend on the external API.
- No database migration runs on deploy; the three SQL files were applied by hand in the Supabase SQL Editor.
- `render.yaml` has not been validated by Render, and the Python version is Render's default (local tests used Python 3.13).
  If the build fails on the Python version, add a `PYTHON_VERSION` environment variable to the backend service.
