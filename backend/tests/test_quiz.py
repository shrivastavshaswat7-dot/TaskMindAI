"""Tests for /api/quiz and /api/quiz/submit (Gemini is mocked).

Run from backend/:  python -m unittest discover -s tests
"""
import json
import os
import sys
import types
import unittest
from unittest import mock

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

# config.py needs real Supabase/Gemini env at import time; the quiz router only
# uses MODEL_NAMES and is_fallback_error, so use a stand-in.
if "config" not in sys.modules:
    fake = types.ModuleType("config")
    fake.MODEL_NAMES = ["model-a", "model-b"]
    fake.is_fallback_error = lambda e: any(
        s in str(e) for s in ("429", "quota", "404")
    )
    sys.modules["config"] = fake

from google.api_core import exceptions as gexc  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from routers import quiz  # noqa: E402

app = FastAPI()
app.include_router(quiz.router)
client = TestClient(app)


def make_questions(n=5):
    return [
        {
            "q": f"Question {i}?",
            "options": [f"a{i}", f"b{i}", f"c{i}", f"d{i}"],
            "answer": f"a{i}",
            "subtopic": f"Sub {i}",
        }
        for i in range(n)
    ]


def fake_model(texts):
    """GenerativeModel stand-in returning/raising each item of `texts` in turn."""
    items = list(texts)

    class Model:
        def __init__(self, *a, **k):
            pass

        def generate_content(self, *a, **k):
            item = items.pop(0)
            if isinstance(item, Exception):
                raise item
            return types.SimpleNamespace(text=item)

    return Model


class QuizGenerateTest(unittest.TestCase):
    def setUp(self):
        quiz.quiz_cache.clear()
        quiz.weakness_cache.clear()

    def post(self, body, texts):
        with mock.patch.object(
            quiz.genai, "GenerativeModel", fake_model(texts)
        ):
            return client.post("/api/quiz", json=body)

    def test_returns_five_valid_questions(self):
        payload = json.dumps({"questions": make_questions()})
        r = self.post({"topic_id": "laplace-transform"}, [payload])
        self.assertEqual(r.status_code, 200)
        qs = r.json()["questions"]
        self.assertEqual(len(qs), 5)
        for q in qs:
            self.assertIn(q["answer"], q["options"])

    def test_extract_generated_topic_id_not_rejected(self):
        payload = json.dumps(make_questions())
        r = self.post({"topic_id": "fourier-series-2"}, [payload])
        self.assertEqual(r.status_code, 200)

    def test_topic_name_sent_by_client_is_used_in_prompt(self):
        seen = {}

        class Model:
            def __init__(self, *a, **k):
                pass

            def generate_content(self, prompt, **k):
                seen["prompt"] = prompt
                return types.SimpleNamespace(
                    text=json.dumps(make_questions())
                )

        with mock.patch.object(quiz.genai, "GenerativeModel", Model):
            r = client.post(
                "/api/quiz",
                json={"topic_id": "x-1", "topic_name": "Green's Theorem"},
            )
        self.assertEqual(r.status_code, 200)
        self.assertIn("Green's Theorem", seen["prompt"])

    def test_fenced_json_accepted(self):
        text = "```json\n" + json.dumps(make_questions()) + "\n```"
        r = self.post({"topic_id": "t"}, [text])
        self.assertEqual(r.status_code, 200)

    def test_invalid_then_valid_retries(self):
        good = json.dumps(make_questions())
        # attempt 1: both models give junk; attempt 2: first model is good
        r = self.post({"topic_id": "t"}, ["not json", "not json", good])
        self.assertEqual(r.status_code, 200)

    def test_quota_error_falls_back_to_next_model(self):
        good = json.dumps(make_questions())
        r = self.post({"topic_id": "t"}, [Exception("429 quota"), good])
        self.assertEqual(r.status_code, 200)

    def test_answer_not_in_options_rejected(self):
        bad = make_questions()
        bad[0]["answer"] = "zzz"
        junk = json.dumps(bad)
        r = self.post({"topic_id": "t"}, [junk] * 4)
        self.assertEqual(r.status_code, 502)

    def test_504_on_first_model_falls_back_to_next(self):
        good = json.dumps(make_questions())
        r = self.post(
            {"topic_id": "t"},
            [gexc.DeadlineExceeded("504 Deadline expired"), good],
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["questions"]), 5)

    def test_503_and_timeout_fall_back(self):
        good = json.dumps(make_questions())
        for err in (gexc.ServiceUnavailable("503"), TimeoutError("timed out")):
            r = self.post({"topic_id": "t"}, [err, good])
            self.assertEqual(r.status_code, 200)

    def test_all_models_time_out_is_502(self):
        # 2 prompt attempts x 2 configured models
        errs = [gexc.DeadlineExceeded("504")] * 4
        r = self.post({"topic_id": "t"}, errs)
        self.assertEqual(r.status_code, 502)

    def test_timeout_is_passed_to_gemini(self):
        seen = {}

        class Model:
            def __init__(self, *a, **k):
                pass

            def generate_content(self, prompt, **k):
                seen.update(k)
                return types.SimpleNamespace(
                    text=json.dumps(make_questions())
                )

        with mock.patch.object(quiz.genai, "GenerativeModel", Model):
            client.post("/api/quiz", json={"topic_id": "t"})
        self.assertEqual(seen["request_options"], {"timeout": 20})

    def test_permanent_4xx_does_not_try_next_model(self):
        calls = []

        class Model:
            def __init__(self, name, **k):
                calls.append(name)

            def generate_content(self, *a, **k):
                raise gexc.InvalidArgument("400 bad request")

        with mock.patch.object(quiz.genai, "GenerativeModel", Model):
            r = client.post("/api/quiz", json={"topic_id": "t"})
        self.assertEqual(r.status_code, 502)
        self.assertEqual(len(calls), 1)

    def test_non_quota_error_is_502(self):
        r = self.post({"topic_id": "t"}, [Exception("boom")])
        self.assertEqual(r.status_code, 502)

    def test_missing_topic_id_is_400(self):
        r = client.post("/api/quiz", json={})
        self.assertEqual(r.status_code, 400)

    def test_each_attempt_is_fresh(self):
        a = json.dumps(make_questions())
        other = make_questions()
        other[0]["q"] = "Different?"
        b = json.dumps(other)
        r1 = self.post({"topic_id": "t"}, [a])
        r2 = self.post({"topic_id": "t"}, [b])
        self.assertNotEqual(r1.json(), r2.json())


class QuizSubmitTest(unittest.TestCase):
    def setUp(self):
        quiz.quiz_cache.clear()
        quiz.weakness_cache.clear()

    def test_scoring_with_client_questions(self):
        qs = make_questions()
        answers = [q["answer"] for q in qs]
        answers[1] = "wrong"
        answers[3] = None
        r = client.post(
            "/api/quiz/submit",
            json={"topic_id": "t", "answers": answers, "questions": qs,
                  "current_weakness": 50},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["score"], 3)
        self.assertEqual(body["total"], 5)
        self.assertEqual(body["weak_subtopics"], ["Sub 1", "Sub 3"])
        # 0.4*50 + 0.6*(100-60) = 44
        self.assertEqual(body["updated_weakness"], 44)

    def test_falls_back_to_server_cache(self):
        qs = make_questions()
        quiz.quiz_cache["t"] = qs
        r = client.post(
            "/api/quiz/submit",
            json={"topic_id": "t", "answers": [q["answer"] for q in qs]},
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["score"], 5)
        # 0.4*50 + 0.6*0
        self.assertEqual(r.json()["updated_weakness"], 20)

    def test_no_quiz_is_400(self):
        r = client.post("/api/quiz/submit",
                        json={"topic_id": "t", "answers": []})
        self.assertEqual(r.status_code, 400)

    def test_answers_must_be_list(self):
        r = client.post("/api/quiz/submit",
                        json={"topic_id": "t", "answers": "x"})
        self.assertEqual(r.status_code, 400)

    def test_invalid_current_weakness_ignored(self):
        qs = make_questions()
        r = client.post(
            "/api/quiz/submit",
            json={"topic_id": "t", "answers": [], "questions": qs,
                  "current_weakness": "abc"},
        )
        self.assertEqual(r.status_code, 200)
        # score 0 -> 0.4*50 + 0.6*100 = 80
        self.assertEqual(r.json()["updated_weakness"], 80)


if __name__ == "__main__":
    unittest.main()
