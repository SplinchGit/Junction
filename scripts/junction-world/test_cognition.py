"""Behavioral regressions for cognition, runnable without a Debian host."""
import ast
import json
import pathlib
import tempfile
import time
import unittest
import uuid
from unittest.mock import Mock

import persistent_runtime as runtime

SOURCE = pathlib.Path(__file__).with_name("agent.py").read_text(encoding="utf8")


def agent_functions(namespace, *names):
    tree = ast.parse(SOURCE)
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "agent.py", "exec"), namespace)
    return namespace


class ContextTests(unittest.TestCase):
    def test_current_message_once_and_instructions_survive_long_tool_session(self):
        state = {"chatHistory": [{"role": "user", "content": "Where am I?", "messageId": "current"}], "memorySummary": "", "goals": []}
        messages = runtime.build_model_messages("Verified Debian environment", state, "Where am I?", "", "", [], "no game")
        self.assertEqual(sum(m["content"].count("Where am I?") for m in messages), 1)
        for i in range(40):
            messages.extend([{"role": "assistant", "content": "action " + str(i)}, {"role": "user", "content": "Runtime-confirmed tool result: result " + str(i)}])
        bounded = runtime.bound_model_messages(messages)
        self.assertEqual(bounded[0]["role"], "system")
        self.assertIn("Verified Debian environment", bounded[0]["content"])
        self.assertIn("Where am I?", str(bounded))
        self.assertEqual(bounded[-1]["content"], "Runtime-confirmed tool result: result 39")
        self.assertLessEqual(len(bounded), 20)
        self.assertLess(len(json.dumps(bounded).encode()), 30000)

    def test_large_unicode_state_stays_inside_broker_limits(self):
        state = {"chatHistory": [{"role": "user", "content": "猫" * 2000}] * 20, "memorySummary": "猫" * 5000, "goals": [{"description": "猫" * 1000}] * 50}
        result = runtime.build_model_messages("Debian tools", state, "Latest request", "猫" * 3000, "猫" * 2500, [{"label": "猫" * 160}] * 128, "PLAYING")
        result = runtime.bound_model_messages(result)
        self.assertLessEqual(len(result[0]["content"]), 8000)
        self.assertLess(len(json.dumps(result, ensure_ascii=False).encode()), 30000)

    def test_valid_large_json_is_parsed_before_display_truncation(self):
        result = runtime.normalize_model_response(json.dumps({"reflection": "x" * 2000, "reply": "Ready", "actions": [{"tool": "write_file", "args": {"path": "projects/demo.py", "content": "#" * 1200}}]}))
        self.assertEqual(result["reply"], "Ready")
        self.assertEqual(result["actions"][0]["tool"], "write_file")


class LoopTests(unittest.TestCase):
    def run_turn(self, outputs, execute=None):
        calls = []
        def rpc(request, **kwargs):
            if request["op"] == "control": return {"paused": False}
            if request["op"] == "infer":
                calls.append(request)
                return {"content": json.dumps(next(outputs))}
            return {}
        with tempfile.TemporaryDirectory() as tmp:
            ns = dict(vars(runtime), ROOT=pathlib.Path(tmp), GAME_PATH=pathlib.Path(tmp)/"game.json", BOOTSTRAP="Debian", MAX_ITERATIONS=4, rpc=rpc, event=Mock(), save_state=Mock(), execute=execute or Mock(return_value={"files": []}), output_json=runtime.normalize_model_response, SCHEDULER=Mock(list_tasks=Mock(return_value=[])), uuid=uuid)
            agent_functions(ns, "model_turn")
            state = {"memorySummary": "", "goals": [], "chatHistory": [], "reflections": [], "decisions": []}
            result = ns["model_turn"](state, "Do the project")
        return result, calls, ns

    def test_work_continues_beyond_four_calls_with_results_and_context(self):
        outputs = iter([{"reply": "", "actions": [{"tool": "read_file", "args": {"path": "projects/" + str(i)}}]} for i in range(6)] + [{"reply": "Finished", "actions": []}])
        result, calls, ns = self.run_turn(outputs)
        self.assertEqual(result["reply"], "Finished")
        self.assertEqual(len(calls), 7)
        self.assertEqual(ns["execute"].call_count, 6)
        self.assertTrue(all(c["request"]["messages"][0]["role"] == "system" for c in calls))

    def test_sleep_stops_further_inference(self):
        def execute(name, args, state):
            state["sleepUntil"] = time.time() + 60
            return {"wakeAt": state["sleepUntil"]}
        result, calls, _ = self.run_turn(iter([{"reply": "Taking a nap", "actions": [{"tool": "sleep_for", "args": {"label": "nap", "seconds": 60}}]}]), execute)
        self.assertEqual(result["reply"], "Taking a nap")
        self.assertEqual(len(calls), 1)

    def test_unchanged_repeated_actions_stop_without_infinite_inference(self):
        action = {"reply": "", "actions": [{"tool": "list_files", "args": {"path": "projects"}}]}
        result, calls, _ = self.run_turn(iter([action] * 3))
        self.assertIn("stuck", result["reply"])
        self.assertEqual(len(calls), 3)

    def test_owner_pause_is_checked_before_tools_execute(self):
        def execute(name, args, state):
            self.fail("paused runtime must not execute a tool")
        # Exercise the function with control changing while inference is running.
        with tempfile.TemporaryDirectory() as tmp:
            controls = iter([False, True])
            def rpc(request, **kwargs):
                if request["op"] == "control": return {"paused": next(controls)}
                if request["op"] == "infer": return {"content": '{"actions":[{"tool":"list_files","args":{"path":"projects"}}]}'}
                return {}
            ns = dict(vars(runtime), ROOT=pathlib.Path(tmp), GAME_PATH=pathlib.Path(tmp)/"game.json", BOOTSTRAP="Debian", rpc=rpc, event=Mock(), save_state=Mock(), execute=execute, output_json=runtime.normalize_model_response, SCHEDULER=Mock(list_tasks=Mock(return_value=[])), uuid=uuid)
            agent_functions(ns, "model_turn")
            with self.assertRaisesRegex(RuntimeError, "paused"):
                ns["model_turn"]({"chatHistory": [], "reflections": [], "decisions": []}, "inspect")

    def test_get_game_does_not_require_coordinates(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp)/"game.json"
            path.write_text(json.dumps(runtime.Minesweeper(seed=1).export()))
            ns = dict(vars(runtime), GAME_PATH=path, event=Mock())
            agent_functions(ns, "execute")
            result = ns["execute"]("get_game", {}, {})
            self.assertIsInstance(result, dict)


if __name__ == "__main__":
    unittest.main()
