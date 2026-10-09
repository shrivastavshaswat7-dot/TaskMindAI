"""Server-side authentication: identity comes from a verified Supabase access token,
never from a user_id sent in the request body, path or form."""
from typing import Optional

from fastapi import Header, HTTPException

from config import supabase


def get_current_user(authorization: Optional[str] = Header(default=None)):
    """FastAPI dependency: validate the `Authorization: Bearer <access_token>` header with Supabase
    and return the user. Responds 401 for a missing, malformed, expired or forged token."""
    scheme, _, token = (authorization or "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Authentication required.")

    try:
        response = supabase.auth.get_user(token)
        user = getattr(response, "user", None)
    except Exception:
        # Do not echo Supabase/internal error text back to the caller
        user = None

    if not user or not getattr(user, "id", None):
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    return user


def resolve_user_id(user, supplied: Optional[str] = None) -> str:
    """The authenticated user's id. A client-supplied user_id is only accepted if it matches
    (older clients still send it); a different one is rejected instead of being trusted."""
    if supplied is not None and str(supplied) != str(user.id):
        raise HTTPException(status_code=403, detail="You can only access your own data.")
    return str(user.id)
