"""Persistence primitives shared by the Junction World runtime."""
import importlib.util
import pathlib
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parent


def load_runtime():
    path = ROOT / "persistent_runtime.py"
    if not path.is_file():
        raise AssertionError("persistent_runtime.py has not been implemented")
    spec = importlib.util.spec_from_file_location("junction_world_persistent_runtime", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PersistentRuntimeTest(unittest.TestCase):
    def test_recent_conversation_excerpt_is_bounded_and_source_labeled(self):
        runtime = load_runtime()
        excerpt = runtime.format_recent_conversation([
            {"role": "user", "source": "debian", "content": "Please greet me."},
            {"role": "assistant", "content": "Hello, James."},
        ])
        self.assertIn("James via Debian local chat: Please greet me.", excerpt)
        self.assertIn("Junction: Hello, James.", excerpt)
        self.assertLessEqual(len(runtime.format_recent_conversation([
            {"role": "user", "content": "x" * 1000} for _ in range(20)
        ])), 6 * (len("James: ") + 320) + 5)
        incoming = runtime.format_incoming_message([
            {"role": "user", "source": "debian", "content": "Please greet me."},
            {"role": "assistant", "content": "Hello, James."},
        ], "What did I just ask?", "debian")
        self.assertIn("Recent messages from your persistent shared conversation", incoming)
        self.assertIn("James via Debian local chat: Please greet me.", incoming)
        self.assertIn("New message from James via Debian local chat:\nWhat did I just ask?", incoming)

    def setUp(self):
        self.runtime = load_runtime()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def test_scheduler_survives_reload_and_supports_cancel(self):
        path = pathlib.Path(self.temp.name) / "scheduler.json"
        store = self.runtime.Scheduler(path)
        now = int(time.time()) + 2
        task = store.schedule("test reminder", now)
        reloaded = self.runtime.Scheduler(path)
        self.assertEqual(reloaded.due_tasks(now)[0]["id"], task["id"])
        self.assertTrue(reloaded.cancel(task["id"]))
        self.assertEqual(reloaded.due_tasks(1234567890), [])

    def test_sleep_and_wake_are_persisted_as_epoch_deadline(self):
        path = pathlib.Path(self.temp.name) / "scheduler.json"
        store = self.runtime.Scheduler(path)
        now = int(time.time())
        task = store.sleep_for("nap", 120, now=now)
        self.assertEqual(task["wakeAt"], now + 120)
        self.assertEqual(self.runtime.Scheduler(path).due_tasks(now + 119), [])
        self.assertEqual(len(self.runtime.Scheduler(path).due_tasks(now + 120)), 1)

    def test_minesweeper_actions_have_machine_readable_state(self):
        game = self.runtime.Minesweeper(width=5, height=5, mines=3, seed=7)
        first = game.reveal(0, 0)
        self.assertTrue(first["accepted"])
        board = game.get_board()
        self.assertEqual((board["width"], board["height"], board["status"]), (5, 5, "PLAYING"))
        self.assertEqual(board["mines"], 3)
        self.assertTrue(game.flag(4, 4)["accepted"])
        self.assertTrue(game.get_board()["cells"][4][4]["flagged"])

    def test_game_rejects_out_of_bounds_and_terminates_on_loss(self):
        game = self.runtime.Minesweeper(width=4, height=4, mines=2, seed=4)
        self.assertFalse(game.reveal(-1, 0)["accepted"])
        mine = next((x, y) for y, row in enumerate(game._board) for x, value in enumerate(row) if value == -1)
        game.reveal(*mine)
        self.assertEqual(game.get_status(), "LOST")


if __name__ == "__main__":
    unittest.main()
