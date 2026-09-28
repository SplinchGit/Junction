"""Model formatting errors must not strand an owner message in the inbox."""
import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parent


def load_agent():
    spec = importlib.util.spec_from_file_location("junction_world_agent_response", ROOT / "persistent_runtime.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AgentResponseTest(unittest.TestCase):
    def setUp(self):
        self.output_json = load_agent().normalize_model_response

    def test_malformed_action_is_dropped_without_losing_reply(self):
        result = self.output_json('{"reflection":"","reply":"I can still answer you.","actions":[{"name":"write_file"}]}')
        self.assertEqual(result, {"reflection": "", "reply": "I can still answer you.", "actions": []})

    def test_unknown_action_is_dropped_without_retrying_forever(self):
        result = self.output_json('{"reflection":"","reply":"Done.","actions":[{"tool":"run_host_command","args":{"command":"x"}}]}')
        self.assertEqual(result["reply"], "Done.")
        self.assertEqual(result["actions"], [])

    def test_unstructured_model_output_becomes_a_plain_chat_reply(self):
        result = self.output_json("The tool format was confusing, but I can still reply.")
        self.assertEqual(result["reply"], "The tool format was confusing, but I can still reply.")
        self.assertEqual(result["actions"], [])


if __name__ == "__main__":
    unittest.main()
