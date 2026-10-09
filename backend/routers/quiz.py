import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
import google.generativeai as genai

from config import MODEL_NAMES, is_fallback_error


router = APIRouter(prefix="/api", tags=["quiz"])

# Project paths
PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOPICS_FILE = PROJECT_ROOT / "Docs" / "mock" / "topics.json"

# In-memory caches
quiz_cache = {}       # topic_id -> list of questions
weakness_cache = {}   # topic_id -> weakness score


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

    last_error = None

    if not MODEL_NAMES:
        raise HTTPException(
            status_code=502,
            detail="No Gemini models are configured.",
        )

    # Up to two prompt attempts.
    for json_attempt in range(2):
        for model_name in MODEL_NAMES:
            try:
                model = genai.GenerativeModel(
                    model_name,
                    system_instruction=(
                        "Generate accurate educational MCQs. "
                        "Follow the requested JSON schema exactly."
                    ),
                )

                response = model.generate_content(prompt)
                raw_text = response.text

                data = parse_json_response(raw_text)
                questions = validate_questions(data)

                # Never cache or return an incomplete quiz.
                if len(questions) == 5:
                    return questions

                last_error = ValueError(
                    "Expected 5 valid questions, "
                    f"but received {len(questions)}."
                )

            except json.JSONDecodeError as exc:
                last_error = exc

            except Exception as exc:
                last_error = exc

                if is_fallback_error(exc):
                    continue

                raise HTTPException(
                    status_code=502,
                    detail="Gemini question generation failed.",
                ) from exc

        if json_attempt == 0:
            prompt += (
                "\n\nYour previous response was invalid or incomplete. "
                "Try again and return exactly 5 valid questions "
                "in the required JSON format."
            )

    raise HTTPException(
        status_code=502,
        detail=(
            "Could not generate exactly 5 valid quiz questions. "
            "Please try again."
        ),
    )


@router.post("/quiz")
async def quiz(payload: dict):
    """Generate or return cached questions for a topic."""
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=400,
            detail="Request body must be a JSON object.",
        )

    topic_id = payload.get("topic_id")

    if not isinstance(topic_id, str) or not topic_id.strip():
        raise HTTPException(
            status_code=400,
            detail="topic_id is required.",
        )

    topic_id = topic_id.strip()

    try:
        topics = load_topics()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc

    if topic_id not in topics:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown topic_id: {topic_id}",
        )

    if topic_id not in quiz_cache:
        questions = generate_questions(topics[topic_id])
        quiz_cache[topic_id] = questions

    return {"questions": quiz_cache[topic_id]}


@router.post("/quiz/submit")
async def quiz_submit(payload: dict):
    """Score submitted answers and update topic weakness."""
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=400,
            detail="Request body must be a JSON object.",
        )

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

    if topic_id not in quiz_cache:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No cached quiz for topic '{topic_id}'. "
                "Call POST /api/quiz for this topic first."
            ),
        )

    questions = quiz_cache[topic_id]
    total = len(questions)

    if total != 5:
        raise HTTPException(
            status_code=400,
            detail="The cached quiz does not contain exactly 5 questions.",
        )

    score = 0
    weak_subtopics = []

    # Missing answers count as incorrect.
    for index, question in enumerate(questions):
        selected = answers[index] if index < len(answers) else None

        if (
            isinstance(selected, str)
            and selected == question["answer"]
        ):
            score += 1
        else:
            weak_subtopics.append(question["subtopic"])

    # Preserve order while removing duplicate subtopics.
    weak_subtopics = list(dict.fromkeys(weak_subtopics))

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