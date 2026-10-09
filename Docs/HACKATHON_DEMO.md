# TaskMindAI: Hackathon Demo Guide

Adaptive study assistant: upload previous-year question papers (PYQs), find the topics that matter, rank them by
priority, build a study plan, test yourself with an AI quiz, and re-rank after each quiz.

## How well is each part verified?

Four different kinds of evidence are used below. They are not equivalent.

| Level | What it is |
|---|---|
| **Real** | Real Supabase and/or real Gemini |
| **Real backend, mocked Supabase** | One-off run of the browser against the real FastAPI code and real Gemini, with Supabase mocked and the auth check bypassed by a local launcher. Not part of the repo |
| **Mocked E2E** | `npm run test:e2e`: real browser, but Supabase **and** `/api` are mocked (`frontend/e2e/support/mockBackend.js`). Checks the UI, state handling and that the session token is attached. Says nothing about real Supabase or Gemini |
| **Unit** | Backend and frontend unit tests with fakes |

| Journey | Evidence |
|---|---|
| PYQ PDFs -> topics -> priorities -> plan -> quiz -> score -> "Update Priorities" saves weakness | **Real backend, mocked Supabase**: browser-driven with 2 sample PDFs, real Gemini quiz (no sample fallback), score 2/5 -> weakness 56 (= 0.4*50 + 0.6*60). Also **Mocked E2E** and **Real** API calls earlier |
| Topics saved per subject, no duplicates on re-extract, weakness kept, refresh persistence, subject switching, failed save reported honestly | **Mocked E2E** (6 tests) + 8 unit tests. Real database: 14 rows exist from a manual test run |
| Login, session survives refresh, logout, wrong password, expired token refreshed + retried, unrefreshable session -> login screen | **Mocked E2E** (7 tests). Real Supabase: forged/missing token rejected (401) |
| API authentication, document ownership, reset-password lockdown, rate limit, generic errors, CORS | **Unit** (25 tests in `backend/tests/test_security.py`) + forged token rejected by **real** Supabase |
| Database constraints (check, not-null, foreign keys, unique) | **Real**, read-only probes that can only fail (no rows created) |
| RLS blocks anonymous access | **Real** (anonymous insert -> `42501`, anonymous select -> empty on a 14-row table) |
| Dashboard, tasks (add), timetable/attendance pages, AI chat, email draft, document list/upload/Q&A | **Mocked E2E** smoke tests only. Never run against real Supabase |
| Real login with a real account in a real browser | **Not done.** No test account is configured, and I do not create accounts or use real users' credentials. An opt-in test is ready: `frontend/e2e/real-login.spec.js` (skipped by default, never run yet, see "Real-login test" below) |
| Isolation between two real users | **Not done** (needs two accounts). Runbook below |

## Architecture

- **Frontend:** React + Vite (`frontend/`), React Router, Supabase JS (login; RLS-protected reads/writes of study data).
- **Backend:** FastAPI (`backend/`), Gemini (`google-generativeai`), Supabase (service role, server only).
- **Auth:** the browser sends `Authorization: Bearer <Supabase access token>` on every `/api` call (`frontend/src/api/authFetch.js`;
  on a 401 it refreshes the session once and retries, else signs out). `backend/auth_utils.py` validates the token with
  Supabase on every route except `/api/health`; the user id always comes from the token, never from the request.
- **Abuse protection:** Gemini-backed routes allow 30 requests per user per minute (`AI_RATE_LIMIT_PER_MINUTE`, in-memory,
  per server process), 10 MB per document upload, generic error messages (details only in server logs).
- **Study data:** `/api/extract` is stateless; the frontend saves topics to `study_topics` (per subject, upsert on
  user + subject + topic, weakness kept on re-extract).

## Setup

1. Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env`; fill in your own values
   (the service-role key and Gemini key go **only** in the backend file; the frontend file is public).
2. Backend (from `backend/`, Python 3.13 was used):
   ```bash
   python -m venv venv
   venv/Scripts/python -m pip install -r requirements.txt
   venv/Scripts/python -m uvicorn main:app --port 8000
   ```
3. Frontend (from `frontend/`):
   ```bash
   npm install
   npm run dev
   ```
4. Open http://localhost:5173. Health check: http://localhost:8000/api/health.
5. Supabase tables: `backend/supabase_schema.sql`, then `backend/migrations/academic_intelligence.sql`, then
   `backend/migrations/study_topics.sql` (Dashboard -> SQL Editor; each is safe to re-run). All three are already applied.
6. Password reset: users reset via the emailed link (configure email/SMTP in Supabase Auth and add
   `http://localhost:5173` to the redirect URLs). The old "instant reset" is disabled unless you explicitly set
   `ALLOW_DIRECT_PASSWORD_RESET=true` (backend) and `VITE_ENABLE_INSTANT_RESET=true` (frontend) on your own machine.

## Tests (reproducible)

```bash
cd backend  && venv/Scripts/python -m unittest discover -s tests   # 73 tests
cd frontend && npm test                                            # 13 unit tests
cd frontend && npm run test:e2e                                    # 19 browser tests, MOCKED backend (uses the installed Edge; BROWSER_CHANNEL=chrome for Chrome)
cd frontend && npm run build
cd frontend && npm run lint                                        # 3 problems remain, all in older code (App.jsx, Auth.jsx effects)
```

### Real-login test (opt-in, not yet run)

Create a throw-away test user in Supabase (Authentication -> Users -> Add user, auto-confirm, no MFA). With the normal backend and
frontend running, from `frontend/`:

```powershell
$env:E2E_REAL_EMAIL="your-test-user@example.com"; $env:E2E_REAL_PASSWORD="..."; npx playwright test e2e/real-login.spec.js
```
It checks real login, session after refresh, an authenticated API call (200), another user's id refused (403), no token refused (401),
and logout. It only reads data and never prints the credentials or token. Without the two variables it is skipped.

## Demo script (3-5 minutes)

1. Log in. Say what it does: it decides what to study next, tests you, and adapts.
2. **PYQ Analysis:** type subject `Maths`, upload 2 PYQ PDFs, Extract (about 5 to 20 seconds). Show topics with frequency and marks.
3. **Priorities:** days left 5, Calculate. Explain the formula (frequency, marks, weakness, exam proximity).
4. **Study Now:** 2 hours, Generate Plan. Show the time blocks and the quiz block.
5. **Quiz:** take it on the top topic, Submit, show the score and weak subtopics.
6. **Update Priorities:** the topic's weakness rises and the ranking changes. Refresh: it is still there (saved in Supabase).
7. Mention the roadmap (exam-readiness score, trend, syllabus-based priorities).

### If something fails during the demo
- **Gemini slow or down:** the quiz falls back to clearly labelled *Sample questions*. Extraction has no fallback, so
  **extract once before the demo** and use the saved topics (they persist per subject).
- **"could not be saved" message:** the topics still work this session; use the data saved in the earlier run.
- **Login problems:** keep a second pre-created account ready. **Backend unreachable:** check `/api/health`, restart uvicorn.
- **"Too many requests" (429):** wait a minute (limit is 30 AI calls per user per minute).
- **Suddenly back on the login screen:** the session expired and could not be refreshed; log in again.

## Deployment checklist (nothing has been deployed)

No hosting provider is configured in the repo and nothing was deployed. What a deployment needs:

- **Frontend:** any static host. Build with `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and
  `VITE_API_BASE_URL=https://<backend host>` (the dev proxy does not exist in production), then serve `frontend/dist`.
  The app uses `BrowserRouter`, so the host must rewrite unknown paths to `index.html` (SPA fallback).
  The built bundle was checked: it contains the API base URL, no `localhost:8000`, and no server keys.
- **Backend:** Python 3.13, `pip install -r backend/requirements.txt`, start with
  `uvicorn main:app --host 0.0.0.0 --port $PORT` from `backend/`. Set `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
  and `EXTRA_ALLOWED_ORIGINS=https://<frontend host>` as server-side secrets. Do **not** set `ALLOW_DIRECT_PASSWORD_RESET`.
  Health check: `/api/health`. Uploads are processed in memory (no persistent disk needed). No migrations run at startup.
- **Supabase (Dashboard -> Authentication -> URL Configuration):** set the Site URL and add the frontend URL to the redirect
  URLs, otherwise the password-reset email link will not return to the app. Configure SMTP for reset emails.
- **Single instance:** the rate limiter is in memory per process; with several instances use a shared store.
- **HTTPS:** terminate TLS at the host; tokens are sent in the `Authorization` header, not cookies.

## Known limitations
- A quiz in *sample mode* still lets "Update Priorities" change the stored weakness (computed from the sample questions).
- A quiz submit alone saves nothing; weakness is saved when "Update Priorities" is clicked.
- Re-extracting a different PDF set updates matching topics but does not delete older ones; stats come from the latest extraction.
- `days left` and `hours` are not saved. Exam-readiness score and PYQ trend are not implemented.
- Gemini output varies between runs (topic merging and averages can differ slightly).
- Quiz questions are generated fresh each time and kept only in memory.

## Verification SQL (Supabase SQL Editor, read-only unless noted)

```sql
-- RLS enabled?
select relname, relrowsecurity from pg_class where relname in ('study_topics','academic_subjects');
-- The policy text (should mention auth.uid() = user_id and the academic_subjects EXISTS check)
select tablename, policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'study_topics';
-- Duplicate check (must return zero rows)
select user_id, subject_id, topic_key, count(*) from study_topics group by 1,2,3 having count(*) > 1;
```

### Two-user isolation test (run once with two real user ids; changes nothing because of the rollback)

Find two user ids in Authentication -> Users, and one subject id belonging to user B. Then:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<USER_A_ID>', 'role', 'authenticated')::text, true);

select count(*) from study_topics where user_id = '<USER_B_ID>';          -- expect 0 (cannot read B's rows)
insert into study_topics (user_id, subject_id, topic_key, name)
  values ('<USER_B_ID>', '<SUBJECT_OF_B>', 'x', 'x');                      -- expect: violates row-level security policy
insert into study_topics (user_id, subject_id, topic_key, name)
  values ('<USER_A_ID>', '<SUBJECT_OF_B>', 'x', 'x');                      -- expect: violates row-level security policy (not your subject)
update study_topics set weakness = 0 where user_id = '<USER_B_ID>';        -- expect: 0 rows updated
rollback;
```
Until this has been run, two-user isolation is **not verified** (only anonymous blocking and the policy design are).
