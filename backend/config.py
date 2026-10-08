import os
from dotenv import load_dotenv
import google.generativeai as genai
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
MODEL_NAMES = [
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
]


def is_fallback_error(e: Exception) -> bool:
    """Quota/rate-limit (429) ya model not found (404) pe agla model try karna hai."""
    msg = str(e)
    return "429" in msg or "quota" in msg.lower() or "404" in msg


class FallbackModel:
    """Pehla model quota/404 pe fail ho toh agla model try karta hai."""

    def __init__(self, names):
        self.names = names
        self.models = [genai.GenerativeModel(n) for n in names]

    def generate_content(self, *args, **kwargs):
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
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]