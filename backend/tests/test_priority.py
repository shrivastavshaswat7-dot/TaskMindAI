"""Tests for /api/priorities and /api/plan.

Run from backend/:  python -m unittest discover -s tests
"""
import json
import os
import sys
import unittest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from routers import priority  # noqa: E402

app = FastAPI()
app.include_router(priority.router)
client = TestClient(app)

MOCK_PATH = os.path.join(BACKEND_DIR, "..", "Docs", "mock", "topics.json")
with open(MOCK_PATH, encoding="utf-8") as f:
    MOCK_TOPICS = json.load(f)["topics"]


def topic(**overrides):
    base = {
        "id": "laplace", "name": "Laplace Transform", "unit": 1,
        "frequency": 7, "papers_total": 10, "avg_marks": 10,
        "years": [2023], "weakness": 50,
    }
    base.update(overrides)
    return base


def get_priorities(topics, days_left=5):
    return client.post("/api/priorities", json={"topics": topics, "days_left": days_left})


def get_plan(ranked, hours, days_left=5):
    return client.post("/api/plan", json={"ranked": ranked, "hours": hours, "days_left": days_left})


def ranked_mock():
    return get_priorities(MOCK_TOPICS).json()["ranked"]


class PrioritiesTest(unittest.TestCase):

    def test_mock_topics_unchanged_from_original_formula(self):
        # Original PR output (max avg_marks in mock = 10, so behaviour is identical)
        expected = {
            1: {"laplace": 84, "fourier": 71, "matrices": 67, "complex-variables": 69,
                "diff-eq": 63, "vector-calculus": 55, "pde": 59},
            5: {"laplace": 80, "fourier": 66, "matrices": 63, "complex-variables": 64,
                "diff-eq": 58, "vector-calculus": 51, "pde": 55},
            30: {"laplace": 74, "fourier": 60, "matrices": 57, "complex-variables": 58,
                 "diff-eq": 52, "vector-calculus": 45, "pde": 49},
        }
        for days_left, scores in expected.items():
            res = get_priorities(MOCK_TOPICS, days_left)
            self.assertEqual(res.status_code, 200)
            ranked = res.json()["ranked"]
            self.assertEqual({t["id"]: t["priority"] for t in ranked}, scores)
            self.assertEqual([t["priority"] for t in ranked],
                             sorted((t["priority"] for t in ranked), reverse=True))

    def test_topic_fields_preserved_and_reason_added(self):
        ranked = get_priorities([topic()]).json()["ranked"]
        self.assertTrue(set(topic()).issubset(ranked[0]))
        self.assertIn("7/10 papers", ranked[0]["reason"])

    def test_avg_marks_16_stays_within_0_100(self):
        topics = [
            topic(id="a", avg_marks=16, frequency=10, papers_total=10, weakness=100),
            topic(id="b", avg_marks=8),
        ]
        ranked = get_priorities(topics, days_left=1).json()["ranked"]
        by_id = {t["id"]: t["priority"] for t in ranked}
        self.assertEqual(by_id["a"], 100)
        self.assertTrue(all(0 <= p <= 100 for p in by_id.values()))
        # max_marks = 16, so 8 marks counts as 50%, not 80%
        self.assertLess(by_id["b"], by_id["a"])

    def test_papers_total_zero_gives_no_frequency_contribution(self):
        res = get_priorities([topic(papers_total=0, avg_marks=0, weakness=0)], days_left=30)
        self.assertEqual(res.status_code, 200)
        # only exam proximity counts: 0.15 * 30
        self.assertEqual(res.json()["ranked"][0]["priority"], 4)

    def test_missing_fields_use_defaults(self):
        res = get_priorities([{"id": "x", "name": "X"}], days_left=5)
        self.assertEqual(res.status_code, 200)
        # weakness default 50 -> 0.25*50 + 0.15*70
        self.assertEqual(res.json()["ranked"][0]["priority"], 23)

    def test_numeric_strings_accepted(self):
        res = get_priorities([topic(frequency="7", papers_total="10", avg_marks="10")], days_left="5")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["ranked"][0]["priority"], get_priorities([topic()]).json()["ranked"][0]["priority"])

    def test_empty_topics(self):
        res = get_priorities([])
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"ranked": []})

    def test_invalid_input_returns_400(self):
        bad_payloads = [
            {"topics": MOCK_TOPICS},                      # missing days_left
            {"topics": MOCK_TOPICS, "days_left": "abc"},  # invalid days_left
            {"topics": MOCK_TOPICS, "days_left": None},
            {"days_left": 5},                             # missing topics
            {"topics": "laplace", "days_left": 5},
            {"topics": ["laplace"], "days_left": 5},
        ]
        for payload in bad_payloads:
            res = client.post("/api/priorities", json=payload)
            self.assertEqual(res.status_code, 400, payload)


class PlanTest(unittest.TestCase):

    def assert_valid_blocks(self, blocks, hours):
        for block in blocks:
            self.assertIsInstance(block["minutes"], int, block)
            self.assertGreaterEqual(block["minutes"], 0, block)
        study = [b for b in blocks if b["topic"] != "Quiz / Active recall"]
        self.assertLessEqual(len(study), 4)
        for block in study:
            self.assertGreaterEqual(block["minutes"], 15, block)
        self.assertEqual(sum(b["minutes"] for b in blocks), round(hours * 60))

    def test_normal_plans_unchanged_from_original(self):
        expected = {
            2: [25, 25, 25, 25, 20],
            3: [45, 40, 40, 35, 20],
            4: [65, 55, 50, 50, 20],
        }
        for hours, minutes in expected.items():
            blocks = get_plan(ranked_mock(), hours).json()["blocks"]
            self.assertEqual([b["minutes"] for b in blocks], minutes)
            self.assertEqual(blocks[0]["topic"], "Laplace Transform")

    def test_one_hour(self):
        # 40 study minutes -> only 2 topics fit at 15+ minutes each
        blocks = get_plan(ranked_mock(), 1).json()["blocks"]
        self.assert_valid_blocks(blocks, 1)
        self.assertEqual([(b["topic"], b["minutes"]) for b in blocks], [
            ("Laplace Transform", 20),
            ("Fourier Series", 20),
            ("Quiz / Active recall", 20),
        ])

    def test_three_quarter_hour(self):
        # 25 study minutes -> only the top topic fits
        blocks = get_plan(ranked_mock(), 0.75).json()["blocks"]
        self.assert_valid_blocks(blocks, 0.75)
        self.assertEqual([(b["topic"], b["minutes"]) for b in blocks], [
            ("Laplace Transform", 25),
            ("Quiz / Active recall", 20),
        ])

    def test_rounding_overflow_never_drops_below_15(self):
        # 4 topics fit exactly (60 study min) but proportional rounding overshoots
        ranked = [dict(t, priority=p) for t, p in zip(ranked_mock(), (100, 1, 1, 1))]
        blocks = get_plan(ranked, 80 / 60).json()["blocks"]
        self.assert_valid_blocks(blocks, 80 / 60)
        self.assertEqual([b["minutes"] for b in blocks], [15, 15, 15, 15, 20])

    def test_tiny_budget_only_quiz(self):
        blocks = get_plan(ranked_mock(), 0.5).json()["blocks"]
        self.assertEqual(blocks, [{"topic": "Quiz / Active recall", "minutes": 30,
                                   "why": "Active recall se topics ko revise karo"}])

    def test_fractional_hours_give_integer_minutes(self):
        for hours in (1.5, 2.25, 1.1):
            self.assert_valid_blocks(get_plan(ranked_mock(), hours).json()["blocks"], hours)

    def test_all_priorities_zero_split_equally(self):
        ranked = [dict(t, priority=0) for t in ranked_mock()[:3]]
        res = get_plan(ranked, 2)
        self.assertEqual(res.status_code, 200)
        blocks = res.json()["blocks"]
        self.assert_valid_blocks(blocks, 2)
        self.assertEqual([b["minutes"] for b in blocks], [35, 35, 30, 20])

    def test_string_hours(self):
        res = get_plan(ranked_mock(), "2")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), get_plan(ranked_mock(), 2).json())

    def test_empty_ranked_returns_quiz_only(self):
        res = get_plan([], 2)
        self.assertEqual(res.status_code, 200)
        self.assertEqual([b["topic"] for b in res.json()["blocks"]], ["Quiz / Active recall"])

    def test_invalid_input_returns_400(self):
        ranked = ranked_mock()
        bad_payloads = [
            {"ranked": ranked},                          # missing hours
            {"ranked": ranked, "hours": "two"},
            {"ranked": ranked, "hours": 0},
            {"ranked": ranked, "hours": -1},
            {"ranked": ranked, "hours": None},
            {"hours": 2},                                # missing ranked
            {"ranked": MOCK_TOPICS, "hours": 2},         # no priority field
            {"ranked": [dict(ranked[0], priority="high")], "hours": 2},
        ]
        for payload in bad_payloads:
            res = client.post("/api/plan", json=payload)
            self.assertEqual(res.status_code, 400, payload)


if __name__ == "__main__":
    unittest.main()
