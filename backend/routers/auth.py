from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from config import supabase

router = APIRouter(prefix="/api/auth", tags=["auth"])


class DirectResetRequest(BaseModel):
    email: str
    new_password: str


@router.post("/reset-password-direct")
async def reset_password_direct(request: DirectResetRequest):
    """Directly reset password using Supabase admin privileges (useful for local development & when email SMTP is restricted)."""
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset password: {str(e)}")
