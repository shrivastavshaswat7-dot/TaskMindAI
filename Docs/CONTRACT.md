# API Contract (FROZEN. Change sirf Shaswat se puch ke)

## Topic
{ "id": "laplace", "name": "Laplace Transform", "unit": 1,
  "frequency": 7, "papers_total": 10, "avg_marks": 10,
  "years": [2019, 2020, 2022, 2023, 2024], "weakness": 50 }

## Endpoints
- POST /api/extract        (PDF file)              -> { "topics": [Topic] }
- POST /api/priorities     { topics, days_left }   -> { "ranked": [Topic + priority(0-100) + reason] }
- POST /api/plan           { ranked, hours, days_left } -> { "blocks": [{ "topic", "minutes", "why" }] }
- POST /api/quiz           { topic_id }            -> { "questions": [{ "q", "options", "answer", "subtopic" }] }
- POST /api/quiz/submit    { topic_id, answers }   -> { "score", "total", "weak_subtopics": [], "updated_weakness" }

## Priority formula (code me, Gemini nahi)
priority = 0.35*freq% + 0.25*marks% + 0.25*weakness + 0.15*exam_proximity
- freq% = frequency / papers_total * 100
- marks% = avg_marks / max_marks * 100
- weakness = 0-100
- exam_proximity = 0-100 (kam days_left = zyada)
Gemini sirf `reason` text likhega, number nahi.

## Rules
- Apni files hi touch karo. App.jsx / routes sirf Shaswat edit karega.
- Gemini API key sirf backend .env me. Commit mat karna.
- Chhote PRs, har 2-3 ghante me merge.
- Contract change chahiye toh pehle Shaswat ko bolo.

## Branches
- feat/extract (Shaswat): /api/extract + integration
- feat/priority-plan (A): /api/priorities, /api/plan
- feat/quiz (B): /api/quiz, /api/quiz/submit
- feat/ui (C): Priority table, Study Now page, Quiz UI