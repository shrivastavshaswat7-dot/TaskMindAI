from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from config import gemini_model

router = APIRouter(prefix="/api/email", tags=["email"])

TONE_DESCRIPTIONS = {
    "formal": "very formal and professional, using polite language appropriate for official correspondence",
    "semi-formal": "semi-formal and courteous, friendly but still professional",
    "casual": "casual and friendly, like writing to a close colleague",
    "apologetic": "sincerely apologetic, taking responsibility and expressing remorse where appropriate",
    "requesting": "politely requesting, clearly stating what is needed while being respectful",
}

CONTEXT_DESCRIPTIONS = {
    "professor": "a university professor or academic instructor",
    "classmate": "a fellow student or classmate",
    "admin": "university administration or staff (registrar, dean's office, etc.)",
    "company": "a company, employer, or internship coordinator",
    "ta": "a teaching assistant or tutor",
}


class DraftReplyRequest(BaseModel):
    original_email: str
    tone: str = "semi-formal"
    context: str = "professor"
    additional_context: Optional[str] = None
    adjust: Optional[str] = None   # "shorter", "longer", "more formal", "more casual"


class DraftReplyResponse(BaseModel):
    draft: str
    subject_line: Optional[str] = None


@router.post("/draft-reply", response_model=DraftReplyResponse)
async def draft_email_reply(request: DraftReplyRequest):
    """Use Gemini AI to draft a professional email reply."""

    tone_desc = TONE_DESCRIPTIONS.get(request.tone, TONE_DESCRIPTIONS["semi-formal"])
    context_desc = CONTEXT_DESCRIPTIONS.get(request.context, CONTEXT_DESCRIPTIONS["professor"])

    adjust_instruction = ""
    if request.adjust:
        adjust_instruction = f"\nAdditional adjustment required: Make the reply {request.adjust}."

    prompt = f"""You are an expert email writing assistant helping a student compose a professional reply to an email they received.

Original email received:
---
{request.original_email}
---

Recipient type: {context_desc}
Required tone: {tone_desc}{f"""
Additional context from student: {request.additional_context}""" if request.additional_context else ""}
{adjust_instruction}

Write a complete email reply. Include:
1. An appropriate greeting
2. A clear, well-structured body addressing the original email
3. A professional closing
4. Signature placeholder: [Your Name]

Also suggest a concise subject line.

Format your response as:
SUBJECT: <subject line here>

<full email body here>

Rules:
- Match the requested tone precisely
- Be clear and to the point
- Use proper email etiquette
- Do NOT include any commentary outside the email itself (no "Here is your email:" etc.)
"""

    try:
        response = gemini_model.generate_content(prompt)
        text = response.text.strip()

        # Parse out subject line if present
        subject_line = None
        if text.startswith("SUBJECT:"):
            lines = text.split("\n", 2)
            subject_line = lines[0].replace("SUBJECT:", "").strip()
            draft = "\n".join(lines[2:]).strip() if len(lines) > 2 else "\n".join(lines[1:]).strip()
        else:
            draft = text

        return DraftReplyResponse(draft=draft, subject_line=subject_line)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Email drafting failed: {str(e)}"
        )


@router.post("/adjust", response_model=DraftReplyResponse)
async def adjust_email(request: DraftReplyRequest):
    """Adjust an already-drafted email (shorter, longer, more formal, etc.)."""
    # Reuse draft_reply with the adjust field
    return await draft_email_reply(request)
