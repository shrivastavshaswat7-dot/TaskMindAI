from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
from auth_utils import get_current_user

from routers import tasks
from routers import ai_chat
from routers import documents
from routers import email_assistant
from routers import auth
from routers import priority
from routers import quiz
from routers import extract

app = FastAPI(
    title="TaskMindAI API",
    description="Backend API for TaskMindAI — AI-powered student productivity assistant",
    version="1.0.0",
)

# auth.router stays public (direct password reset is disabled unless explicitly enabled, see routers/auth.py).
# Every other API needs a valid Supabase access token (Authorization: Bearer <token>).
app.include_router(auth.router)
_protected = [Depends(get_current_user)]
app.include_router(tasks.router, dependencies=_protected)
app.include_router(ai_chat.router, dependencies=_protected)
app.include_router(documents.router, dependencies=_protected)
app.include_router(email_assistant.router, dependencies=_protected)
app.include_router(priority.router, dependencies=_protected)
app.include_router(quiz.router, dependencies=_protected)
app.include_router(extract.router, dependencies=_protected)

# CORS — allow the Vite dev server to make requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health check
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "message": "TaskMindAI API is running", "version": "1.0.0"}
