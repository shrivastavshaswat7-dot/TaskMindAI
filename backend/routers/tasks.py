from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from config import gemini_model
import json

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


class Task(BaseModel):
    id: str
    title: str
    completed: bool = False
    due_date: str | None = None
    priority: str = "medium"
    category: str = "general"


class PrioritizeRequest(BaseModel):
    tasks: list[Task]


class PrioritizedTask(BaseModel):
    id: str
    ai_priority_score: float
    ai_priority_reason: str
    suggested_priority: str


class PrioritizeResponse(BaseModel):
    prioritized_tasks: list[PrioritizedTask]


@router.post("/prioritize", response_model=PrioritizeResponse)
async def prioritize_tasks(request: PrioritizeRequest):
    """Use Gemini AI to analyze and prioritize a list of tasks."""

    if not request.tasks:
        return PrioritizeResponse(prioritized_tasks=[])

    # Filter out completed tasks — no point prioritizing done tasks
    pending_tasks = [t for t in request.tasks if not t.completed]

    if not pending_tasks:
        return PrioritizeResponse(prioritized_tasks=[])

    # Build the prompt
    task_descriptions = []
    for task in pending_tasks:
        desc = f"- ID: {task.id} | Title: \"{task.title}\" | Due: {task.due_date or 'No due date'} | Current priority: {task.priority} | Category: {task.category}"
        task_descriptions.append(desc)

    tasks_text = "\n".join(task_descriptions)

    prompt = f"""You are a student productivity assistant. Analyze these tasks and assign each a priority score and brief reasoning.

Tasks:
{tasks_text}

For each task, consider:
1. Due date urgency (closer deadlines = higher priority)
2. Current priority label set by the student
3. Academic importance based on the title/category
4. Task complexity and time needed

Respond in VALID JSON only, no markdown, no code fences. Use this exact format:
{{
  "prioritized_tasks": [
    {{
      "id": "task_id_here",
      "ai_priority_score": 0.85,
      "ai_priority_reason": "Brief reason why this priority",
      "suggested_priority": "high"
    }}
  ]
}}

Rules:
- ai_priority_score: float between 0.0 (lowest) and 1.0 (highest)
- suggested_priority: one of "low", "medium", "high", "urgent"
- Sort by ai_priority_score descending (highest priority first)
- Keep ai_priority_reason under 30 words
"""

    try:
        response = gemini_model.generate_content(prompt)
        text = response.text.strip()

        # Clean up response — remove markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1]  # remove first line
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]  # remove last fence
        text = text.strip()

        result = json.loads(text)
        return PrioritizeResponse(**result)

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"AI returned invalid JSON: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"AI prioritization failed: {str(e)}"
        )
