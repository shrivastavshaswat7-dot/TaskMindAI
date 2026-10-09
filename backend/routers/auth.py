import logging
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from config import supabase

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


class DirectResetRequest(BaseModel):
    email: str
    new_password: str


def direct_reset_enabled() -> bool:
    return os.getenv("ALLOW_DIRECT_PASSWORD_RESET", "").strip().lower() in ("1", "true", "yes")


@router.post("/reset-password-direct")
async def reset_password_direct(request: DirectResetRequest):
    """Directly reset password using Supabase admin privileges (useful for local development & when email SMTP is restricted)."""
    # INSECURE: resets any account's password knowing only its email (uses the Supabase admin key).
    # Local development only. Disabled unless ALLOW_DIRECT_PASSWORD_RESET=true. NEVER enable this on a
    # public deployment; users should use the emailed reset link instead.
    if not direct_reset_enabled():
        raise HTTPException(status_code=404, detail="Not found")

    if len(request.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    try:
        users = supabase.auth.admin.list_users()
        target_user = next((u for u in users if u.email.lower() == request.email.lower()), None)

        if not target_user:
            raise HTTPException(status_code=404, detail="No account registered with this email address.")

        supabase.auth.admin.update_user_by_id(
            target_user.id,
            {"password": request.new_password}
        )
        return {"status": "success", "message": "Password reset successfully. You can now login with your new password."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Direct password reset failed")
        raise HTTPException(status_code=500, detail="Failed to reset password.")
