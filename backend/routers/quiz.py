from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["quiz"])


@router.post("/quiz")
async def quiz(payload: dict):
    # TODO (B): Gemini se questions banao
    return {"questions": []}


@router.post("/quiz/submit")
async def quiz_submit(payload: dict):
    # TODO (B): score nikalo aur weak subtopics batao
    return {"score": 0, "total": 0, "weak_subtopics": [], "updated_weakness": 0}