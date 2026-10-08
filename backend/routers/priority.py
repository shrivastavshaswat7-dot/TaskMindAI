import math

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api", tags=["priority"])

DEFAULT_WEAKNESS = 50
MAX_PLAN_TOPICS = 4
MIN_BLOCK_MINUTES = 15
QUIZ_MINUTES = 20


def to_number(value, default=0.0):
    # "5" jaise numeric strings bhi chalenge; galat value pe default
    if isinstance(value, bool):
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def required_number(payload, key):
    value = payload.get(key)
    number = to_number(value, default=None)
    if number is None:
        raise HTTPException(status_code=400, detail=f"'{key}' must be a number")
    return number


def clamp(value, low, high):
    return max(low, min(high, value))


def calculate_priority(topic, days_left, max_marks):
    frequency = to_number(topic.get("frequency"))
    papers_total = to_number(topic.get("papers_total"))
    avg_marks = to_number(topic.get("avg_marks"))
    weakness = clamp(to_number(topic.get("weakness"), DEFAULT_WEAKNESS), 0, 100)

    # papers_total 0 ho toh frequency ka contribution 0
    freq_percent = (frequency / papers_total) * 100 if papers_total > 0 else 0
    freq_percent = clamp(freq_percent, 0, 100)

    # CONTRACT.md: marks% = avg_marks / max_marks * 100 (max = sabse zyada avg_marks)
    marks_percent = (avg_marks / max_marks) * 100 if max_marks > 0 else 0
    marks_percent = clamp(marks_percent, 0, 100)

    if days_left <= 1:
        exam_proximity = 100
    elif days_left <= 3:
        exam_proximity = 90
    elif days_left <= 7:
        exam_proximity = 70
    elif days_left <= 14:
        exam_proximity = 50
    else:
        exam_proximity = 30

    priority = (
        0.35 * freq_percent
        + 0.25 * marks_percent
        + 0.25 * weakness
        + 0.15 * exam_proximity
    )

    return int(clamp(priority, 0, 100))


def make_reason(topic):
    return (
        f'{topic.get("frequency", 0)}/{topic.get("papers_total", 0)} papers me aaya, '
        f'avg {topic.get("avg_marks", 0)} marks, '
        f'weakness {topic.get("weakness", DEFAULT_WEAKNESS)}'
    )


def make_study_blocks(ranked, hours):
    total_minutes = int(round(hours * 60))

    # Quiz ke liye 20 minutes reserve
    quiz_minutes = QUIZ_MINUTES
    study_minutes = total_minutes - quiz_minutes

    if study_minutes < MIN_BLOCK_MINUTES:
        return [
            {
                "topic": "Quiz / Active recall",
                "minutes": total_minutes,
                "why": "Active recall se topics ko revise karo"
            }
        ]

    # Har topic ko kam se kam 15 min mile, isliye time kam ho toh topics kam karo
    topic_count = min(MAX_PLAN_TOPICS, study_minutes // MIN_BLOCK_MINUTES)
    top_topics = ranked[:topic_count]

    priorities = [max(0, to_number(topic.get("priority"))) for topic in top_topics]
    total_priority = sum(priorities)

    blocks = []

    for topic, topic_priority in zip(top_topics, priorities):
        if total_priority > 0:
            minutes = (topic_priority / total_priority) * study_minutes
        else:
            # Sab priority 0 ho toh time barabar baanto
            minutes = study_minutes / len(top_topics)

        # 5 ke multiple me round karo
        minutes = int(round(minutes / 5) * 5)

        # Minimum 15 minutes
        minutes = max(MIN_BLOCK_MINUTES, minutes)

        blocks.append(
            {
                "topic": topic.get("name") or topic.get("id") or "Topic",
                "minutes": minutes,
                "why": f'Priority {topic["priority"]} ke basis par study time diya gaya'
            }
        )

    # Rounding ke baad total adjust karo
    current_total = sum(block["minutes"] for block in blocks)
    difference = study_minutes - current_total

    if blocks and difference >= 0:
        blocks[0]["minutes"] += difference
    elif blocks:
        # Zyada ho gaya toh sabse bade blocks se kaato, kisi ko 15 se neeche nahi.
        # Barabar hon toh kam priority wale (neeche wale) block se pehle.
        excess = -difference
        while excess > 0:
            block = max(reversed(blocks), key=lambda b: b["minutes"])
            cut = min(excess, block["minutes"] - MIN_BLOCK_MINUTES)
            block["minutes"] -= cut
            excess -= cut

    blocks.append(
        {
            "topic": "Quiz / Active recall",
            "minutes": quiz_minutes,
            "why": "Padhe hue topics ko recall aur test karne ke liye"
        }
    )

    return blocks


@router.post("/priorities")
async def priorities(payload: dict):
    topics = payload.get("topics")
    if not isinstance(topics, list) or not all(isinstance(t, dict) for t in topics):
        raise HTTPException(status_code=400, detail="'topics' must be a list of topic objects")

    days_left = required_number(payload, "days_left")

    max_marks = max((to_number(t.get("avg_marks")) for t in topics), default=0)

    ranked = []

    for topic in topics:
        priority = calculate_priority(topic, days_left, max_marks)

        ranked_topic = {
            **topic,
            "priority": priority,
            "reason": make_reason(topic)
        }

        ranked.append(ranked_topic)

    ranked.sort(key=lambda topic: topic["priority"], reverse=True)

    return {"ranked": ranked}


@router.post("/plan")
async def plan(payload: dict):
    ranked = payload.get("ranked")
    if not isinstance(ranked, list) or not all(isinstance(t, dict) for t in ranked):
        raise HTTPException(status_code=400, detail="'ranked' must be a list of topic objects")

    # CONTRACT.md: /plan ko /priorities ka output (priority ke saath) milna chahiye
    if any(to_number(topic.get("priority"), default=None) is None for topic in ranked):
        raise HTTPException(
            status_code=400,
            detail="Every ranked topic needs a numeric 'priority'. Call /api/priorities first."
        )

    hours = required_number(payload, "hours")
    if round(hours * 60) < 1:
        raise HTTPException(status_code=400, detail="'hours' must be greater than 0")

    blocks = make_study_blocks(ranked, hours)

    return {"blocks": blocks}