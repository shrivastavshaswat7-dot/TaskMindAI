from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List
import json
import google.generativeai as genai

router = APIRouter(prefix="/api/ai", tags=["ai"])


class ChatMessage(BaseModel):
    role: str  # "user" or "model"
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    system_context: str = ""


SYSTEM_PROMPT = """You are TaskMind AI, an intelligent study companion for students.
You help students with:
- Understanding academic concepts and explaining them clearly
- Summarizing study material and creating study guides
- Planning study schedules and managing tasks
- Answering questions about their subjects
- Providing tips for exams and productivity

Be concise, friendly, and encouraging. Use markdown formatting where helpful (bullet points, bold text, code blocks for programming topics). 
Always tailor your response to the context of a student."""


@router.post("/chat")
async def chat(request: ChatRequest):
    """Chat with Gemini AI. Returns a streaming SSE response."""

    # Build the conversation history for Gemini
    history = []
    messages = request.messages

    # All but the last message form the history
    for msg in messages[:-1]:
        history.append({
            "role": msg.role,
            "parts": [msg.content]
        })

    # The last message is the current user input
    user_input = messages[-1].content if messages else ""

    # Build system instruction
    system_instruction = SYSTEM_PROMPT
    if request.system_context:
        system_instruction += f"\n\nAdditional context about this student:\n{request.system_context}"

    model = genai.GenerativeModel(
        "gemini-3.8-flash",
        system_instruction=system_instruction
    )

    chat_session = model.start_chat(history=history)

    async def generate():
        try:
            response = chat_session.send_message(user_input, stream=True)
            for chunk in response:
                if chunk.text:
                    data = json.dumps({"chunk": chunk.text})
                    yield f"data: {data}\n\n"
            # Signal end of stream
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )
