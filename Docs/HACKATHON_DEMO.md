# TaskMindAI: Hackathon Demo Guide

Adaptive study assistant: upload previous-year question papers (PYQs), find the topics that matter,
rank them by priority, build a study plan, test yourself with an AI quiz, and re-rank after each quiz.

## What works (and how it was checked)

| Journey | Status |
|---|---|
| PYQ PDFs -> topics (frequency, average marks, years) via Gemini | Verified against real Gemini through the API (2 sample PDFs) |
| Topics -> priority ranking -> study plan | Verified through the API; code-level formulas are unit tested |
| AI quiz (generate, answer, score, weak subtopics) | Verified through the API with real Gemini; unit tested |
| Topics + weakness saved per subject in Supabase (`study_topics`) | 14 rows seen in the database after a manual test; RLS blocks anonymous writes (checked) |
| Auth on every API (Supabase token), document ownership, password reset closed | Unit tested + forged/missing token rejected against real Supabase. A real logged-in click-through is still a manual step |
| Chat assistant, email drafts, task prioritization, document Q&A | Chat/email/tasks verified through the API before auth was added; document upload and Q&A not exercised |
| Dashboard, Timetable, Attendance, Tasks (Supabase CRUD) | Not tested here |

**Not verified:** the complete UI in a browser with a real login, and cross-user isolation with two real accounts
(see "Verification SQL" for the database part).

## Architecture

- **Frontend:** React + Vite (`frontend/`), React Router, Supabase JS client (login, and RLS-protected reads/writes of study data).
- **Backend:** FastAPI (`backend/`), Gemini (`google-generativeai`), Supabase (service-role, server only).
- **Auth:** the browser sends `Authorization: Bearer <Supabase access token>`; `backend/auth_utils.py` validates it with
  Supabase on every `/api` route except `/api/health`. The user id always comes from the token, never from the request body.
- **Study data:** `/api/extract` is stateless; the frontend saves topics to `study_topics` (per subject, upsert on
  user + subject + topic, weakness kept on re-extract).

## Setup

1. Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env`; fill in your own values
   (service-role key and Gemini key go **only** in the backend file).
2. Backend (from `backend/`):
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
5. Supabase: tables come from `backend/supabase_schema.sql`, `backend/migrations/academic_intelligence.sql`, then
   `backend/migrations/study_topics.sql` (run once in the Dashboard SQL Editor; safe to re-run). This one has already been applied.
6. Password reset: users reset via the emailed link (Supabase Auth must have email/SMTP configured and
   `http://localhost:5173` in the allowed redirect URLs). The old "instant reset" is disabled unless you explicitly set
   `ALLOW_DIRECT_PASSWORD_RESET=true` (backend) and `VITE_ENABLE_INSTANT_RESET=true` (frontend) on your own machine.

## Tests

```bash
cd backend  && venv/Scripts/python -m unittest discover -s tests   # 64 tests
cd frontend && npm test                                            # 13 tests
cd frontend && npm run build
```
`npm run lint` still reports 7 problems that predate this work (`App.jsx`, `Auth.jsx`, `AiAssistant.jsx`).

## Demo script (3-5 minutes)

1. Log in. Say what it does: it decides what to study next, tests you, and adapts.
2. **PYQ Analysis:** type subject `Maths`, upload 2 PYQ PDFs, Extract. Show topics with frequency and marks (takes a few seconds).
3. **Priorities:** set days left to 5, Calculate. Explain the formula (frequency, marks, weakness, exam proximity).
4. **Study Now:** 2 hours, Generate Plan. Show the time blocks and the quiz block.
5. **Quiz:** Take quiz on the top topic, answer, Submit, show score and weak subtopics.
6. **Update Priorities:** the topic's weakness rises and the ranking changes. Refresh the page: it is still there (saved in Supabase).
7. Mention the adaptive loop and the roadmap (exam-readiness score, trends, syllabus-based priorities).

## If something fails during the demo

- **Gemini slow or down:** the quiz falls back to clearly labelled *Sample questions*. Extraction has no fallback, so
  **extract once before the demo** and rely on the saved topics (they persist per subject).
- **Save error ("could not be saved"):** topics still work for this session; show the saved data from the earlier run.
- **Login problems:** have a second pre-created test account ready.
- **Backend unreachable:** check http://localhost:8000/api/health; restart uvicorn.

## Known limitations

- Quiz in *sample mode* still lets "Update Priorities" change the stored weakness (from the sample questions).
- A quiz submit alone does not save anything; weakness is saved when "Update Priorities" is clicked.
- Re-extracting a different PDF set updates matching topics but does not delete old ones; stats come from the latest extraction.
- `days left` / `hours` are not saved. Exam-readiness score and PYQ trend are not implemented.
- Gemini output varies between runs (topic merging and averages can differ slightly).
- The first Gemini calls can still be slow if a model is down; fallbacks and a 60 s timeout apply (`backend/config.py`).
- Quiz questions are generated fresh per attempt and held only in memory.

## Verification SQL (Supabase SQL Editor, read-only)

```sql
-- RLS enabled?
select relname, relrowsecurity from pg_class where relname in ('study_topics','academic_subjects');
-- Policies
select tablename, policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'study_topics';
-- Constraints (unique, checks, foreign keys)
select conname, contype, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.study_topics'::regclass;
-- Duplicate check (must return zero rows)
select user_id, subject_id, topic_key, count(*) from study_topics group by 1,2,3 having count(*) > 1;
```
