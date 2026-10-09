import json
import logging
import re
import statistics
from collections import Counter, defaultdict
from typing import List

from fastapi import APIRouter, File, HTTPException, UploadFile

from config import gemini_model


router = APIRouter(prefix="/api", tags=["extract"])

# Gemini inline request ~20 MB tak leta hai, prompt ke liye thodi jagah chhodi
MAX_TOTAL_BYTES = 18 * 1024 * 1024


PROMPT = """
You are analyzing previous-year question papers of one university subject.

The uploaded PDFs are given in order:
paper 1, paper 2, paper 3, ...

Extract EVERY actual question that carries marks.

Return ONLY a JSON array.

Each item must have exactly:
{
  "paper": <1-based PDF index>,
  "year": <exam year as integer or null>,
  "unit": <syllabus unit number as integer or null>,
  "topic": "<short canonical topic name>",
  "marks": <marks as number>
}

Rules:
- Use the SAME topic name for the same concept across papers.
- Topic names must be short, syllabus-style names.
- Example: always use "Laplace Transform", not "Laplace transforms" or "LT".
- If the unit is not explicitly written, infer it from the topic.
- Do not include question-paper instructions, headers, OR/choice text.
- Extract sub-questions separately when they carry separate marks.
"""


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "topic"


def parse_json(text: str):
    text = text.strip()

    # Remove ```json ... ``` if Gemini adds markdown fences
    text = re.sub(r"^```(?:json)?", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"```$", "", text).strip()

    return json.loads(text)


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_int(value):
    # Gemini kabhi kabhi "2023" jaise strings bhejta hai
    number = to_float(value)
    return int(number) if number is not None else None


def aggregate(items: list, papers_total: int) -> list:
    groups = defaultdict(list)

    for item in items:
        if not isinstance(item, dict):
            continue

        topic = str(item.get("topic") or "").strip()

        if not topic:
            continue

        item["topic"] = topic
        groups[topic.lower()].append(item)

    topics = []
    used_ids = set()

    for rows in groups.values():

        name = Counter(
            row["topic"]
            for row in rows
        ).most_common(1)[0][0]

        units = [
            unit
            for unit in (to_int(row.get("unit")) for row in rows)
            if unit is not None
        ]

        marks = [
            value
            for value in (
                to_float(row.get("marks"))
                for row in rows
            )
            if value is not None
        ]

        years = sorted({
            year
            for year in (to_int(row.get("year")) for row in rows)
            if year is not None
        })

        papers = {
            paper
            for paper in (to_int(row.get("paper")) for row in rows)
            if paper is not None and 1 <= paper <= papers_total
        }

        # "C" aur "C++" dono "c" na ban jayein
        topic_id = slugify(name)
        suffix = 2
        while topic_id in used_ids:
            topic_id = f"{slugify(name)}-{suffix}"
            suffix += 1
        used_ids.add(topic_id)

        topics.append({
            "id": topic_id,
            "name": name,
            "unit": (
                Counter(units).most_common(1)[0][0]
                if units
                else 0
            ),
            # Topic kam se kam ek paper mein toh aaya hi hai
            "frequency": max(len(papers), 1),
            "papers_total": papers_total,
            "avg_marks": (
                round(statistics.mean(marks), 1)
                if marks
                else 0
            ),
            "years": years,

            # Initial value.
            # Quiz module later updates this.
            "weakness": 50,
        })

    topics.sort(
        key=lambda topic: (
            -topic["frequency"],
            -topic["avg_marks"]
        )
    )

    return topics


@router.post("/extract")
async def extract(
    files: List[UploadFile] = File(...)
):
    """
    Upload multiple PYQ PDFs and extract
    topic-level academic intelligence.
    """

    if len(files) > 10:
        raise HTTPException(
            status_code=400,
            detail="Maximum 10 PDFs allowed at once"
        )

    parts = []
    total_bytes = 0

    for file in files:

        # Kuch browsers/OS PDF ko application/octet-stream bhejte hain
        is_pdf = (
            file.content_type == "application/pdf"
            or (file.filename or "").lower().endswith(".pdf")
        )

        if not is_pdf:
            raise HTTPException(
                status_code=400,
                detail=f"{file.filename} is not a PDF"
            )

        data = await file.read()
        total_bytes += len(data)

        if total_bytes > MAX_TOTAL_BYTES:
            raise HTTPException(
                status_code=400,
                detail="PDFs too large. Keep total upload under 18 MB."
            )

        if data:
            parts.append({
                "mime_type": "application/pdf",
                "data": data
            })

    if not parts:
        raise HTTPException(
            status_code=400,
            detail="No PDF received"
        )

    try:
        response = gemini_model.generate_content(
            [PROMPT] + parts,
            generation_config={
                "response_mime_type": "application/json"
            }
        )

        items = parse_json(response.text)

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=502,
            detail="Gemini returned invalid JSON. Try again."
        )

    except Exception:
        logging.getLogger(__name__).exception("Gemini extraction failed")
        raise HTTPException(
            status_code=502,
            detail="The AI service failed to analyze the PDFs. Please try again."
        )

    # Kabhi Gemini array ko {"questions": [...]} mein wrap kar deta hai
    if isinstance(items, dict):
        items = next(
            (value for value in items.values() if isinstance(value, list)),
            items
        )

    if not isinstance(items, list):
        raise HTTPException(
            status_code=502,
            detail="Unexpected Gemini output"
        )

    topics = aggregate(
        items,
        len(parts)
    )

    return {
        "topics": topics
    }