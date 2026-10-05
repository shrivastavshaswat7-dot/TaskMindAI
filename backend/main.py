from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS

from routers import tasks
from routers import ai_chat
from routers import documents
from routers import email_assistant
from routers import auth

app = FastAPI(
    title="TaskMindAI API",
    description="Backend API for TaskMindAI — AI-powered student productivity assistant",
    version="1.0.0",
)

app.include_router(auth.router)
app.include_router(tasks.router)
app.include_router(ai_chat.router)
app.include_router(documents.router)
app.include_router(email_assistant.router)

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
