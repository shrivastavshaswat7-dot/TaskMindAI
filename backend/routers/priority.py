from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["priority"])


def calculate_priority(topic, days_left):
    frequency = topic["frequency"]
    papers_total = topic["papers_total"]
    avg_marks = topic["avg_marks"]
    weakness = topic["weakness"]

    freq_percent = (frequency / papers_total) * 100
    marks_percent = (avg_marks / 10) * 100

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

    return int(priority)


def make_reason(topic):
    return (
        f'{topic["frequency"]}/{topic["papers_total"]} papers me aaya, '
        f'avg {topic["avg_marks"]} marks, weakness {topic["weakness"]}'
    )


def make_study_blocks(ranked, hours):
    total_minutes = hours * 60

    # Quiz ke liye 20 minutes reserve
    quiz_minutes = 20
    study_minutes = total_minutes - quiz_minutes

    if study_minutes < 15:
        return [
            {
                "topic": "Quiz / Active recall",
                "minutes": total_minutes,
                "why": "Active recall se topics ko revise karo"
            }
        ]

    top_topics = ranked[:4]

    total_priority = sum(topic["priority"] for topic in top_topics)

    blocks = []

    for topic in top_topics:
        minutes = (topic["priority"] / total_priority) * study_minutes

        # 5 ke multiple me round karo
        minutes = int(round(minutes / 5) * 5)

        # Minimum 15 minutes
        minutes = max(15, minutes)

        blocks.append(
            {
                "topic": topic["name"],
                "minutes": minutes,
                "why": f'Priority {topic["priority"]} ke basis par study time diya gaya'
            }
        )

    # Rounding ke baad total adjust karo
    current_total = sum(block["minutes"] for block in blocks)
    difference = study_minutes - current_total

    if blocks:
        blocks[0]["minutes"] += difference

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
    topics = payload["topics"]
    days_left = payload["days_left"]

    ranked = []

    for topic in topics:
        priority = calculate_priority(topic, days_left)

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
    ranked = payload["ranked"]
    hours = payload["hours"]

    blocks = make_study_blocks(ranked, hours)

    return {"blocks": blocks}