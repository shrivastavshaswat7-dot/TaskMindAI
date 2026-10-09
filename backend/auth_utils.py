"""Server-side authentication: identity comes from a verified Supabase access token,
never from a user_id sent in the request body, path or form."""
import os
import threading
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import Depends, Header, HTTPException

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


# --- per-user rate limit for the Gemini-backed endpoints (protects the API quota) -----------------
# In-memory sliding window: per server process, reset on restart. Enough for one backend instance.
RATE_LIMIT_PER_MINUTE = int(os.getenv("AI_RATE_LIMIT_PER_MINUTE", "30"))
_RATE_WINDOW_SECONDS = 60
_hits = defaultdict(deque)
_hits_lock = threading.Lock()


def rate_limit(user=Depends(get_current_user)):
    """Dependency: at most RATE_LIMIT_PER_MINUTE AI requests per user per minute, else 429."""
    now = time.monotonic()
    with _hits_lock:
        window = _hits[str(user.id)]
        while window and now - window[0] > _RATE_WINDOW_SECONDS:
            window.popleft()
        if len(window) >= RATE_LIMIT_PER_MINUTE:
            retry_after = max(1, int(_RATE_WINDOW_SECONDS - (now - window[0])))
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please wait a moment and try again.",
                headers={"Retry-After": str(retry_after)},
            )
        window.append(now)
    return user
