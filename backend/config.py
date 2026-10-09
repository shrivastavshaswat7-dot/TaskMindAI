import os
from dotenv import load_dotenv
import google.generativeai as genai
from google.api_core import exceptions as google_exceptions
from supabase import create_client, Client

load_dotenv()

# --- Supabase ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# --- Gemini ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

genai.configure(api_key=GEMINI_API_KEY)

# Fallback order — sabse pehla model primary hai. Chat bhi yahi list use karta hai.
# Tez chalne wale models pehle: gemini-3.8-flash / 3.7-flash ne 504 (timeout) diya,
# jisse har AI request ~25-30s leti thi. Wo ab aakhir mein fallback ke liye hain.
MODEL_NAMES = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-2.5-flash",
]

# Har Gemini call ka timeout (seconds), taaki ek atka hua model poori request na roke
GEMINI_TIMEOUT_SECONDS = 60


def is_fallback_error(e: Exception) -> bool:
    """Quota/rate-limit (429), model not found (404), timeout ya 5xx pe agla model try karna hai."""
    if isinstance(e, (google_exceptions.ServerError, TimeoutError)):
        return True
    msg = str(e)
    return "429" in msg or "quota" in msg.lower() or "404" in msg


class FallbackModel:
    """Pehla model quota/404 pe fail ho toh agla model try karta hai."""

    def __init__(self, names):
        self.names = names
        self.models = [genai.GenerativeModel(n) for n in names]

    def generate_content(self, *args, **kwargs):
        kwargs.setdefault("request_options", {"timeout": GEMINI_TIMEOUT_SECONDS})
        last_error = None
        for name, model in zip(self.names, self.models):
            try:
                return model.generate_content(*args, **kwargs)
            except Exception as e:
                if is_fallback_error(e):
                    print(f"[gemini] {name} fail hua, agla model try kar raha hoon")
                    last_error = e
                    continue
                raise
        raise last_error

    def __getattr__(self, item):
        # baaki cheezein (jaise start_chat) pehle model se chalengi
        if item in ("names", "models"):
            raise AttributeError(item)
        return getattr(self.models[0], item)


gemini_model = FallbackModel(MODEL_NAMES)

# --- App Settings ---
# Local dev origins are only allowed outside production (APP_ENV=production uses just EXTRA_ALLOWED_ORIGINS)
ALLOWED_ORIGINS = (
    []
    if os.getenv("APP_ENV", "").strip().lower() == "production"
    else ["http://localhost:5173", "http://127.0.0.1:5173"]
)
# Deployed frontend URL(s), comma separated, e.g. EXTRA_ALLOWED_ORIGINS=https://taskmind.example.com
ALLOWED_ORIGINS += [
    origin.strip().rstrip("/")
    for origin in os.getenv("EXTRA_ALLOWED_ORIGINS", "").split(",")
    if origin.strip() and origin.strip() != "*"
]
if os.getenv("APP_ENV", "").strip().lower() == "production" and not ALLOWED_ORIGINS:
    print("[config] WARNING: APP_ENV=production but EXTRA_ALLOWED_ORIGINS is empty - "
          "browsers will be blocked by CORS. Set it to the frontend URL.")