import json
import logging
import math
import re
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from google.api_core import exceptions as google_exceptions
import google.generativeai as genai

from config import MODEL_NAMES, is_fallback_error


router = APIRouter(prefix="/api", tags=["quiz"])

# Project paths
PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOPICS_FILE = PROJECT_ROOT / "Docs" / "mock" / "topics.json"

# In-memory fallbacks (lost on restart, shared across users). The client can
# send `questions` / `current_weakness` itself, so these are only a fallback.
quiz_cache = {}       # topic_id -> latest generated questions
weakness_cache = {}   # topic_id -> weakness score

MAX_TOPIC_NAME_LEN = 100

# Per-call Gemini timeout in SECONDS (google-generativeai RequestOptions).
GEMINI_TIMEOUT_SECONDS = 15
# The whole /api/quiz request gets at most this long (seconds), and at most this many Gemini calls, however many
# models are configured. (It used to be 2 prompts x every model x 20 s = minutes, which the browser gave up on.)
QUIZ_DEADLINE_SECONDS = 45
MAX_MODEL_ATTEMPTS = 4

logger = logging.getLogger("taskmind.quiz")


def load_topics():
    """Load topic IDs and names from topics.json."""
    try:
        with TOPICS_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)

        if not isinstance(data, dict):
            raise ValueError("topics.json must contain a JSON object.")

        topics = data.get("topics", [])

        if not isinstance(topics, list):
            raise ValueError("'topics' must be a list.")

        return {
            topic["id"]: topic["name"]
            for topic in topics
            if isinstance(topic, dict)
            and isinstance(topic.get("id"), str)
            and isinstance(topic.get("name"), str)
            and topic["id"].strip()
            and topic["name"].strip()
        }

    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise RuntimeError(f"Could not load topics.json: {exc}") from exc


def resolve_topic_name(topic_id, payload):
    """Topic name: client-sent `topic_name`, else topics.json, else from the id.

    /api/extract makes new topic ids that are not in the mock topics.json, so an
    unknown id must not be rejected.
    """
    name = payload.get("topic_name")
    if isinstance(name, str) and name.strip():
        return " ".join(name.split())[:MAX_TOPIC_NAME_LEN]

    try:
        known = load_topics()
    except RuntimeError:
        known = {}
    if topic_id in known:
        return known[topic_id]

    # "laplace-transform-2" -> "laplace transform"
    readable = re.sub(r"-\d+$", "", topic_id).replace("-", " ").strip()
    return readable[:MAX_TOPIC_NAME_LEN] or topic_id[:MAX_TOPIC_NAME_LEN]


def is_transient_error(exc):
    """Timeouts and 5xx (500/503/504...): worth trying the next model.

    Validation errors, bad requests (4xx) and auth problems are not included.
    """
    return isinstance(
        exc,
        (google_exceptions.ServerError, TimeoutError),
    )


def to_weakness(value):
    """0-100 number, or None if missing/invalid."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value):
        return None
    return max(0, min(100, value))


def parse_json_response(text):
    """Parse JSON, including responses wrapped in Markdown fences."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Gemini returned an empty response.")

    text = text.strip()
    text = re.sub(
        r"^```(?:json)?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\s*```$", "", text)

    return json.loads(text)


def validate_questions(data):
    """Return up to five valid questions with four distinct options."""
    if isinstance(data, dict):
        data = data.get("questions", [])

    if not isinstance(data, list):
        return []

    valid = []

    for item in data:
        if not isinstance(item, dict):
            continue

        question = item.get("q")
        options = item.get("options")
        answer = item.get("answer")
        subtopic = item.get("subtopic")

        if not isinstance(question, str) or not question.strip():
            continue

        if (
            not isinstance(options, list)
            or len(options) != 4
            or not all(
                isinstance(option, str) and option.strip()
                for option in options
            )
            or len(set(options)) != 4
        ):
            continue

        if not isinstance(answer, str) or answer not in options:
            continue

        if not isinstance(subtopic, str) or not subtopic.strip():
            continue

        valid.append({
            "q": question.strip(),
            "options": options,
            "answer": answer,
            "subtopic": subtopic.strip(),
        })

        if len(valid) == 5:
            break

    return valid


MSG_NOT_CONFIGURED = "The AI quiz service is not configured correctly on the server. Please tell the site owner."
MSG_BUSY = "The AI service is busy right now (usage limit reached). Please try again in a minute."
MSG_SLOW = "The AI service took too long to answer. Please try again."
RETRY_HINT = (
    "\n\nYour previous response was invalid or incomplete. "
    "Try again and return exactly 5 valid questions in the required JSON format."
)


def classify_provider_error(exc):
    """'config' (key missing/invalid/no permission), 'busy' (quota, rate limit, model not found),
    'timeout' (timeout or 5xx) or 'other' (anything else, not worth retrying)."""
    text = str(exc)
    name = type(exc).__name__
    if (
        isinstance(exc, (google_exceptions.PermissionDenied, google_exceptions.Unauthenticated))
        or name == "DefaultCredentialsError"
        or "api key" in text.lower()
        or "API_KEY" in text
    ):
        return "config"
    if is_transient_error(exc):
        return "timeout"
    if is_fallback_error(exc):
        return "busy"
    return "other"


def generate_questions(topic_name):
    """Generate exactly five valid questions using Gemini."""
    prompt = f"""
You are an academic quiz generator for students.

Generate exactly 5 multiple-choice questions about:
{topic_name}

Adapt the questions to the topic and its academic subject.
Use an appropriate student-level difficulty.
If the topic is Engineering Mathematics-II, use relevant
university-level engineering mathematics concepts and style.

Return ONLY valid JSON in this exact structure:
{{
  "questions": [
    {{
      "q": "Question text",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "answer": "Exact text of the correct option",
      "subtopic": "Specific concept tested"
    }}
  ]
}}

Rules:
- Return exactly 5 questions.
- Each question must have exactly 4 distinct string options.
- Each question must have exactly one correct answer.
- The answer must exactly match one of its options.
- Give every question a meaningful, specific subtopic.
- Avoid duplicate questions.
- Do not include Markdown fences or explanations outside JSON.
"""

    if not MODEL_NAMES:
        raise HTTPException(status_code=503, detail=MSG_NOT_CONFIGURED)

    deadline = time.monotonic() + QUIZ_DEADLINE_SECONDS
    models = list(MODEL_NAMES)[:MAX_MODEL_ATTEMPTS]
    outcomes = []          # what went wrong, per attempt: "invalid" | "busy" | "timeout"

    for model_name in models:
        remaining = deadline - time.monotonic()
        if remaining < 3:
            break

        try:
            model = genai.GenerativeModel(
                model_name,
                system_instruction=(
                    "Generate accurate educational MCQs. "
                    "Follow the requested JSON schema exactly."
                ),
            )

            response = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
                request_options={
                    "timeout": min(GEMINI_TIMEOUT_SECONDS, remaining)
                },
            )
            data = parse_json_response(response.text)
            questions = validate_questions(data)

            # Never cache or return an incomplete quiz.
            if len(questions) == 5:
                return questions

            outcomes.append("invalid")
            logger.warning("quiz: %s returned %d valid questions", model_name, len(questions))
            prompt += RETRY_HINT

        except ValueError as exc:
            # Bad JSON, empty/blocked response (response.text raises ValueError)
            outcomes.append("invalid")
            logger.warning("quiz: %s gave an unusable response (%s)", model_name, type(exc).__name__)
            prompt += RETRY_HINT

        except Exception as exc:
            kind = classify_provider_error(exc)
            logger.warning("quiz: %s failed (%s, %s)", model_name, type(exc).__name__, kind)

            if kind == "config":
                # Wrong/missing key or no permission: every other model fails the same way
                raise HTTPException(status_code=503, detail=MSG_NOT_CONFIGURED) from exc
            if kind == "other":
                raise HTTPException(status_code=502, detail="Gemini question generation failed.") from exc
            outcomes.append(kind)           # "busy" (quota/429/404) or "timeout" (5xx/timeouts): try the next model

    if outcomes and all(o == "busy" for o in outcomes):
        raise HTTPException(status_code=503, detail=MSG_BUSY)
    if outcomes and all(o in ("busy", "timeout") for o in outcomes):
        raise HTTPException(status_code=504, detail=MSG_SLOW)
    raise HTTPException(
        status_code=502,
        detail="Could not generate exactly 5 valid quiz questions. Please try again.",
    )


@router.post("/quiz")
def quiz(payload: dict):
    """Generate a fresh quiz. Plain `def` so the blocking Gemini call runs in
    FastAPI's threadpool instead of freezing the event loop."""
    topic_id = payload.get("topic_id")

    if not isinstance(topic_id, str) or not topic_id.strip():
        raise HTTPException(
            status_code=400,
            detail="topic_id is required.",
        )

    topic_id = topic_id.strip()
    topic_name = resolve_topic_name(topic_id, payload)

    # Fresh questions every attempt; the latest set is kept only as a
    # fallback for /quiz/submit.
    questions = generate_questions(topic_name)
    quiz_cache[topic_id] = questions

    return {"questions": questions}


@router.post("/quiz/submit")
def quiz_submit(payload: dict):
    """Score submitted answers and update topic weakness.

    Optional extras (the contract's {topic_id, answers} still works):
      questions         - the questions the user was shown; makes scoring
                          independent of the server-side cache
      current_weakness  - the topic's weakness the app currently holds
    """
    topic_id = payload.get("topic_id")
    answers = payload.get("answers")

    if not isinstance(topic_id, str) or not topic_id.strip():
        raise HTTPException(
            status_code=400,
            detail="topic_id is required.",
        )

    topic_id = topic_id.strip()

    if not isinstance(answers, list):
        raise HTTPException(
            status_code=400,
            detail="answers must be a list of selected option texts.",
        )

    questions = validate_questions(payload.get("questions"))
    if not questions:
        questions = quiz_cache.get(topic_id, [])

    if not questions:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No quiz found for topic '{topic_id}'. "
                "Call POST /api/quiz for this topic first."
            ),
        )

    total = len(questions)
    score = 0
    weak_subtopics = []

    # Missing answers count as incorrect.
    for index, question in enumerate(questions):
        selected = answers[index] if index < len(answers) else None

        if isinstance(selected, str) and selected == question["answer"]:
            score += 1
        else:
            weak_subtopics.append(question["subtopic"])

    # Preserve order while removing duplicate subtopics.
    weak_subtopics = list(dict.fromkeys(weak_subtopics))

    old_weakness = to_weakness(payload.get("current_weakness"))
    if old_weakness is None:
        old_weakness = weakness_cache.get(topic_id, 50)
    performance_weakness = 100 - (score / total * 100)

    updated_weakness = round(
        0.4 * old_weakness + 0.6 * performance_weakness
    )

    weakness_cache[topic_id] = updated_weakness

    return {
        "score": score,
        "total": total,
        "weak_subtopics": weak_subtopics,
        "updated_weakness": updated_weakness,
    }
