from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["extract"])


@router.post("/extract")
async def extract():
    # TODO (Shaswat): PDF se topics nikalo
    return {"topics": []}
