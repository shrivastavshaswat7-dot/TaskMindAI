"""Tests for config.py Gemini model order and FallbackModel (Gemini is mocked).

Run from backend/:  python -m unittest discover -s tests
"""
import importlib.util
import os
import sys
import types
import unittest
from unittest import mock

from google.api_core import exceptions as gexc

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)


def load_config():
    """Load the real config.py under a private name, without touching Supabase."""
    spec = importlib.util.spec_from_file_location(
        "config_under_test", os.path.join(BACKEND_DIR, "config.py")
    )
    module = importlib.util.module_from_spec(spec)
    with mock.patch("supabase.create_client", return_value=object()):
        spec.loader.exec_module(module)
    return module


config = load_config()


def make_models(behaviours):
    """Replace the FallbackModel's models with stubs, one behaviour per model."""
    calls = []

    def make(index, behaviour):
        class Stub:
            def generate_content(self, *a, **k):
                calls.append((index, k))
                if isinstance(behaviour, Exception):
                    raise behaviour
                return types.SimpleNamespace(text=behaviour)

        return Stub()

    fm = config.FallbackModel(["m%d" % i for i in range(len(behaviours))])
    fm.models = [make(i, b) for i, b in enumerate(behaviours)]
    return fm, calls


class ModelOrderTest(unittest.TestCase):
    def test_slow_models_are_not_first(self):
        # gemini-3.8-flash / 3.7-flash timed out (504) in testing
        self.assertNotIn(config.MODEL_NAMES[0], ("gemini-3.8-flash", "gemini-3.7-flash"))
        self.assertLess(
            config.MODEL_NAMES.index("gemini-3.5-flash-lite"),
            config.MODEL_NAMES.index("gemini-3.8-flash"),
        )


class IsFallbackErrorTest(unittest.TestCase):
    def test_transient_and_quota_errors_fall_back(self):
        for err in (
            gexc.DeadlineExceeded("504"),
            gexc.ServiceUnavailable("503"),
            TimeoutError("t"),
            Exception("429 quota exceeded"),
            Exception("404 model not found"),
        ):
            self.assertTrue(config.is_fallback_error(err), err)

    def test_permanent_errors_do_not(self):
        for err in (gexc.InvalidArgument("400 bad"), ValueError("x"), Exception("boom")):
            self.assertFalse(config.is_fallback_error(err), err)


class FallbackModelTest(unittest.TestCase):
    def test_timeout_default_is_passed(self):
        fm, calls = make_models(["ok"])
        fm.generate_content("hi")
        self.assertEqual(
            calls[0][1]["request_options"], {"timeout": config.GEMINI_TIMEOUT_SECONDS}
        )

    def test_caller_request_options_are_respected(self):
        fm, calls = make_models(["ok"])
        fm.generate_content("hi", request_options={"timeout": 5})
        self.assertEqual(calls[0][1]["request_options"], {"timeout": 5})

    def test_504_falls_back_to_next_model(self):
        fm, calls = make_models([gexc.DeadlineExceeded("504"), "ok"])
        self.assertEqual(fm.generate_content("hi").text, "ok")
        self.assertEqual([c[0] for c in calls], [0, 1])

    def test_permanent_error_is_raised_without_fallback(self):
        fm, calls = make_models([gexc.InvalidArgument("400"), "ok"])
        with self.assertRaises(gexc.InvalidArgument):
            fm.generate_content("hi")
        self.assertEqual(len(calls), 1)

    def test_all_models_fail_raises_last_error(self):
        fm, _ = make_models([gexc.DeadlineExceeded("a"), gexc.ServiceUnavailable("b")])
        with self.assertRaises(gexc.ServiceUnavailable):
            fm.generate_content("hi")


if __name__ == "__main__":
    unittest.main()
