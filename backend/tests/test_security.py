"""Security regression tests: authentication, ownership and the password-reset flag.

Supabase and Gemini are faked. Run from backend/:  python -m unittest discover -s tests
"""
import os
import sys
import types
import unittest
from unittest import mock

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

USER_A = types.SimpleNamespace(id="user-a", email="a@example.com")
USER_B = types.SimpleNamespace(id="user-b", email="b@example.com")
TOKENS = {"token-a": USER_A, "token-b": USER_B}


class FakeQuery:
    """Records the chained Supabase calls so tests can see which user_id a query was scoped to."""

    def __init__(self, table, log):
        self.table, self.log = table, log

    def __getattr__(self, name):
        def call(*args, **kwargs):
            if name == "execute":
                self.log.append((self.table, "execute", ()))
                return types.SimpleNamespace(data=[])
            self.log.append((self.table, name, args))
            return self
        return call


class FakeAdmin:
    def __init__(self):
        self.updated = []

    def list_users(self):
        return [types.SimpleNamespace(id="user-b", email="b@example.com")]

    def update_user_by_id(self, user_id, attrs):
        self.updated.append(user_id)


class FakeAuth:
    def __init__(self):
        self.admin = FakeAdmin()

    def get_user(self, token):
        if token not in TOKENS:
            raise Exception("invalid JWT (internal detail that must not leak)")
        return types.SimpleNamespace(user=TOKENS[token])


class FakeSupabase:
    def __init__(self):
        self.auth = FakeAuth()
        self.log = []

    def table(self, name):
        return FakeQuery(name, self.log)


fake_supabase = FakeSupabase()

# test_quiz.py may already have put a minimal fake `config` in sys.modules: extend whatever is there
config = sys.modules.get("config") or types.ModuleType("config")
sys.modules["config"] = config
config.supabase = fake_supabase
config.gemini_model = mock.MagicMock()
config.ALLOWED_ORIGINS = ["http://localhost:5173"]
if not hasattr(config, "MODEL_NAMES"):
    config.MODEL_NAMES = ["model-a"]
if not hasattr(config, "is_fallback_error"):
    config.is_fallback_error = lambda e: False
config.supabase = fake_supabase

from fastapi.testclient import TestClient  # noqa: E402

import auth_utils  # noqa: E402
import main  # noqa: E402

auth_utils.supabase = fake_supabase
import routers.auth as auth_router  # noqa: E402
import routers.documents as documents_router  # noqa: E402

documents_router.supabase = fake_supabase
auth_router.supabase = fake_supabase

client = TestClient(main.app)
A = {"Authorization": "Bearer token-a"}


class AuthenticationTest(unittest.TestCase):
    def test_health_is_public(self):
        self.assertEqual(client.get("/api/health").status_code, 200)

    def test_protected_routes_reject_missing_token(self):
        calls = [
            ("get", "/api/documents/list/user-a", {}),
            ("post", "/api/documents/query", {"json": {"question": "q"}}),
            ("delete", "/api/documents/delete", {"json": {"document_id": "d"}}),
            ("post", "/api/quiz", {"json": {"topic_id": "t"}}),
            ("post", "/api/quiz/submit", {"json": {"topic_id": "t", "answers": []}}),
            ("post", "/api/priorities", {"json": {"topics": [], "days_left": 3}}),
            ("post", "/api/plan", {"json": {"ranked": [], "hours": 1}}),
            ("post", "/api/ai/chat", {"json": {"messages": []}}),
            ("post", "/api/email/draft-reply", {"json": {"original_email": "x"}}),
            ("post", "/api/tasks/prioritize", {"json": {"tasks": []}}),
            ("post", "/api/extract", {}),
        ]
        for method, url, kwargs in calls:
            r = client.request(method.upper(), url, **kwargs)
            self.assertEqual(r.status_code, 401, f"{method.upper()} {url} -> {r.status_code}")

    def test_invalid_and_malformed_tokens_are_401_without_leaking_details(self):
        for header in ("Bearer nope", "Basic token-a", "token-a", "Bearer ", ""):
            r = client.get("/api/documents/list/user-a", headers={"Authorization": header})
            self.assertEqual(r.status_code, 401, header)
            self.assertNotIn("internal detail", r.text)

    def test_valid_token_is_accepted(self):
        r = client.get("/api/documents/list/user-a", headers=A)
        self.assertEqual(r.status_code, 200)


class OwnershipTest(unittest.TestCase):
    def setUp(self):
        fake_supabase.log.clear()

    def scoped_user_ids(self, table):
        return [a[1] for (t, n, a) in fake_supabase.log if t == table and n == "eq" and a[0] == "user_id"]

    def test_list_other_users_documents_is_403(self):
        r = client.get("/api/documents/list/user-b", headers=A)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(fake_supabase.log, [])   # nothing was even queried

    def test_list_own_documents_is_scoped_to_token_user(self):
        r = client.get("/api/documents/list/user-a", headers=A)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.scoped_user_ids("documents"), ["user-a"])

    def test_delete_with_someone_elses_user_id_is_403(self):
        r = client.request("DELETE", "/api/documents/delete", headers=A,
                           json={"document_id": "d1", "user_id": "user-b"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(fake_supabase.log, [])

    def test_delete_uses_the_token_user_not_the_body(self):
        r = client.request("DELETE", "/api/documents/delete", headers=A, json={"document_id": "d1"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.scoped_user_ids("documents"), ["user-a"])

    def test_query_is_scoped_to_token_user(self):
        client.post("/api/documents/query", headers=A, json={"question": "what is x"})
        self.assertEqual(self.scoped_user_ids("document_chunks"), ["user-a"])

    def test_query_with_other_user_id_is_403(self):
        r = client.post("/api/documents/query", headers=A,
                        json={"question": "x", "user_id": "user-b"})
        self.assertEqual(r.status_code, 403)

    def test_upload_for_another_user_is_403(self):
        r = client.post("/api/documents/upload", headers=A, data={"user_id": "user-b"},
                        files={"file": ("n.txt", b"hello", "text/plain")})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(fake_supabase.log, [])

    def test_upload_larger_than_limit_is_413(self):
        big = b"x" * (documents_router.MAX_UPLOAD_BYTES + 1)
        r = client.post("/api/documents/upload", headers=A,
                        files={"file": ("big.txt", big, "text/plain")})
        self.assertEqual(r.status_code, 413)
        self.assertEqual(fake_supabase.log, [])

    def test_resolve_user_id(self):
        self.assertEqual(auth_utils.resolve_user_id(USER_A), "user-a")
        self.assertEqual(auth_utils.resolve_user_id(USER_A, "user-a"), "user-a")
        with self.assertRaises(Exception) as ctx:
            auth_utils.resolve_user_id(USER_A, "user-b")
        self.assertEqual(ctx.exception.status_code, 403)


class PasswordResetTest(unittest.TestCase):
    body = {"email": "b@example.com", "new_password": "hacked-password"}

    def setUp(self):
        fake_supabase.auth.admin.updated.clear()

    def test_direct_reset_is_disabled_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ALLOW_DIRECT_PASSWORD_RESET", None)
            r = client.post("/api/auth/reset-password-direct", json=self.body)
        self.assertEqual(r.status_code, 404)
        self.assertEqual(fake_supabase.auth.admin.updated, [])   # the victim's password was NOT changed

    def test_direct_reset_stays_disabled_for_false_like_values(self):
        for value in ("", "false", "0", "no"):
            with mock.patch.dict(os.environ, {"ALLOW_DIRECT_PASSWORD_RESET": value}):
                r = client.post("/api/auth/reset-password-direct", json=self.body)
            self.assertEqual(r.status_code, 404, value)
        self.assertEqual(fake_supabase.auth.admin.updated, [])

    def test_direct_reset_works_only_when_explicitly_enabled_for_local_dev(self):
        with mock.patch.dict(os.environ, {"ALLOW_DIRECT_PASSWORD_RESET": "true"}):
            r = client.post("/api/auth/reset-password-direct", json=self.body)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(fake_supabase.auth.admin.updated, ["user-b"])


B = {"Authorization": "Bearer token-b"}
TASKS_BODY = {"tasks": [{"id": "1", "title": "t", "completed": False}]}


class RateLimitTest(unittest.TestCase):
    def setUp(self):
        auth_utils._hits.clear()
        config.gemini_model.generate_content.side_effect = Exception("boom")

    def tearDown(self):
        config.gemini_model.generate_content.side_effect = None
        auth_utils._hits.clear()

    def test_ai_endpoints_are_rate_limited_per_user(self):
        with mock.patch.object(auth_utils, "RATE_LIMIT_PER_MINUTE", 3):
            statuses = [client.post("/api/tasks/prioritize", headers=A, json=TASKS_BODY).status_code
                        for _ in range(4)]
            self.assertNotIn(429, statuses[:3])
            self.assertEqual(statuses[3], 429)
            blocked = client.post("/api/tasks/prioritize", headers=A, json=TASKS_BODY)
            self.assertIn("Retry-After", blocked.headers)
            # another user is not affected by user A's usage
            self.assertNotEqual(client.post("/api/tasks/prioritize", headers=B, json=TASKS_BODY).status_code, 429)

    def test_non_ai_routes_are_not_rate_limited(self):
        with mock.patch.object(auth_utils, "RATE_LIMIT_PER_MINUTE", 1):
            codes = [client.post("/api/priorities", headers=A, json={"topics": [], "days_left": 3}).status_code
                     for _ in range(3)]
        self.assertEqual(codes, [200, 200, 200])

    def test_unauthenticated_requests_do_not_consume_the_limit(self):
        with mock.patch.object(auth_utils, "RATE_LIMIT_PER_MINUTE", 1):
            for _ in range(3):
                self.assertEqual(client.post("/api/tasks/prioritize", json=TASKS_BODY).status_code, 401)


class ErrorLeakTest(unittest.TestCase):
    SECRET = "SECRET-INTERNAL-DETAIL postgres://user:pw@host/db"

    def setUp(self):
        auth_utils._hits.clear()
        config.gemini_model.generate_content.side_effect = Exception(self.SECRET)

    def tearDown(self):
        config.gemini_model.generate_content.side_effect = None
        auth_utils._hits.clear()

    def assert_generic(self, response, expected_status):
        self.assertEqual(response.status_code, expected_status)
        self.assertNotIn("SECRET", response.text)
        self.assertNotIn("postgres", response.text)
        self.assertNotIn("Traceback", response.text)

    def test_task_prioritization_failure_is_generic(self):
        self.assert_generic(client.post("/api/tasks/prioritize", headers=A, json=TASKS_BODY), 500)

    def test_email_drafting_failure_is_generic(self):
        r = client.post("/api/email/draft-reply", headers=A, json={"original_email": "hello"})
        self.assert_generic(r, 500)

    def test_pdf_extraction_failure_is_generic(self):
        r = client.post("/api/extract", headers=A,
                        files={"files": ("p.pdf", b"%PDF-1.4 test", "application/pdf")})
        self.assert_generic(r, 502)


class CorsTest(unittest.TestCase):
    def preflight(self, origin):
        return client.options(
            "/api/quiz",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )

    def test_allowed_origin_gets_cors_headers(self):
        r = self.preflight("http://localhost:5173")
        self.assertEqual(r.headers.get("access-control-allow-origin"), "http://localhost:5173")

    def test_unknown_origin_gets_no_cors_allowance(self):
        r = self.preflight("https://evil.example.com")
        self.assertNotIn("access-control-allow-origin", r.headers)

    def test_wildcard_is_never_allowed(self):
        self.assertNotIn("*", main.ALLOWED_ORIGINS)


class ProductionDocsTest(unittest.TestCase):
    def test_api_docs_are_hidden_in_production(self):
        from fastapi import FastAPI
        prod = TestClient(FastAPI(**main.docs_settings("production")))
        for path in ("/docs", "/redoc", "/openapi.json"):
            self.assertEqual(prod.get(path).status_code, 404, path)

    def test_api_docs_remain_available_in_development(self):
        from fastapi import FastAPI
        dev = TestClient(FastAPI(**main.docs_settings("")))
        self.assertEqual(dev.get("/docs").status_code, 200)

    def test_app_env_is_read_case_insensitively(self):
        self.assertEqual(main.docs_settings(" Production ")["openapi_url"], None)


if __name__ == "__main__":
    unittest.main()
