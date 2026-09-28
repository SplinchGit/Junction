"""Portable tests for the Junction World display-safe viewer history."""
import importlib.util
import json
import pathlib
import tempfile
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("viewer_history.py")


def load_history_type():
    if not MODULE_PATH.is_file():
        raise AssertionError("viewer_history.py has not been implemented")
    spec = importlib.util.spec_from_file_location("junction_world_viewer_history", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load viewer_history.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.ViewerHistory


def communication(event_id, communication_id, direction, message, occurred_at="2026-09-25T12:00:00Z"):
    return {
        "id": event_id,
        "occurredAt": occurred_at,
        "category": "COMMUNICATION",
        "summary": "Conversation message",
        "details": message,
        "communicationId": communication_id,
        "conversationId": "550e8400-e29b-41d4-a716-446655440000",
        "communicationDirection": direction,
        "privatePrompt": "must not be retained",
    }


class ViewerHistoryTest(unittest.TestCase):
    def setUp(self):
        self.ViewerHistory = load_history_type()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = pathlib.Path(self.directory.name) / "viewer-history.json"

    def test_message_is_deduplicated_and_markup_is_kept_as_plain_text(self):
        history = self.ViewerHistory(self.path)
        message = "<script>alert('still text')</script>"
        first = communication(
            "650e8400-e29b-41d4-a716-446655440001",
            "650e8400-e29b-41d4-a716-446655440002",
            "OWNER_TO_AGENT",
            message,
        )
        duplicate = {**first, "id": "650e8400-e29b-41d4-a716-446655440003"}

        self.assertTrue(history.append(first))
        self.assertFalse(history.append(duplicate))

        records = history.snapshot()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["message"], message)
        self.assertEqual(records[0]["communicationDirection"], "OWNER_TO_AGENT")
        self.assertNotIn("privatePrompt", records[0])
        self.assertNotIn("details", records[0])

    def test_activity_drops_raw_details_and_unapproved_fields(self):
        history = self.ViewerHistory(self.path)
        history.append({
            "id": "650e8400-e29b-41d4-a716-446655440010",
            "occurredAt": "2026-09-25T12:01:00Z",
            "category": "ACTION",
            "summary": "Read a workspace file.",
            "details": "secret tool argument and file contents",
            "actionStatus": "SUCCEEDED",
            "durationMs": 120,
            "credential": "never persist",
        })

        self.assertEqual(history.snapshot(), [{
            "id": "650e8400-e29b-41d4-a716-446655440010",
            "occurredAt": "2026-09-25T12:01:00Z",
            "category": "ACTION",
            "summary": "Read a workspace file.",
            "actionStatus": "SUCCEEDED",
            "durationMs": 120,
        }])

    def test_message_length_count_and_serialized_history_are_bounded(self):
        history = self.ViewerHistory(self.path, max_items=2, max_bytes=2500)
        for index in range(3):
            event_id = f"650e8400-e29b-41d4-a716-44665544001{index}"
            communication_id = f"650e8400-e29b-41d4-a716-44665544002{index}"
            history.append(communication(event_id, communication_id, "AGENT_TO_OWNER", "x" * 2800))

        records = history.snapshot()
        self.assertEqual(len(records), 1)
        self.assertTrue(records[0]["id"].endswith("0022"))
        self.assertEqual(len(records[0]["message"]), 2000)
        self.assertTrue(records[0]["message"].endswith("…"))
        self.assertLessEqual(self.path.stat().st_size, 2500)
        self.assertEqual(json.loads(self.path.read_text(encoding="utf8")), records)

    def test_corrupt_history_starts_empty_and_invalid_events_are_rejected(self):
        self.path.write_text("{not json", encoding="utf8")
        history = self.ViewerHistory(self.path)
        self.assertEqual(history.snapshot(), [])
        self.assertTrue(history.degraded)
        with self.assertRaises(ValueError):
            history.append({"id": "not-a-uuid", "category": "ACTION"})

    def test_invalid_unhashable_fields_and_surrogate_text_do_not_break_history(self):
        history = self.ViewerHistory(self.path)
        with self.assertRaises(ValueError):
            history.append({"category": [], "id": "650e8400-e29b-41d4-a716-446655440030"})

        event = communication(
            "650e8400-e29b-41d4-a716-446655440031",
            "650e8400-e29b-41d4-a716-446655440032",
            "OWNER_TO_AGENT",
            "bad\ud800text",
        )
        self.assertTrue(history.append(event))
        self.assertEqual(history.snapshot()[0]["message"], "bad?text")


if __name__ == "__main__":
    unittest.main()
