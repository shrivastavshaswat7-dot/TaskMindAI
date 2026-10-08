from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["priority"])


@router.post("/priorities")
async def priorities(payload: dict):
    # TODO (A): Docs/CONTRACT.md ka formula use karke topics rank karo
    return {"ranked": []}


@router.post("/plan")
async def plan(payload: dict):
    # TODO (A): hours aur days_left se study blocks banao
    return {"blocks": []}