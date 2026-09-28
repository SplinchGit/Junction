"""Native client protocol and rendering tests without a graphical display."""
import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("native_chat", pathlib.Path(__file__).with_name("native-chat.py"))
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class NativeChatTests(unittest.TestCase):
    def test_shared_android_and_debian_messages_are_displayed_as_plain_text(self):
        snapshot = {"status": "IDLE", "activity": "Waiting", "model": "qwen3.5:2b", "events": [
            {"category": "COMMUNICATION", "communicationDirection": "OWNER_TO_AGENT", "source": "android", "message": "From phone"},
            {"category": "COMMUNICATION", "communicationDirection": "OWNER_TO_AGENT", "source": "debian", "message": "From Debian"},
            {"category": "COMMUNICATION", "communicationDirection": "AGENT_TO_OWNER", "message": "<script>untrusted</script>"},
            {"category": "REFLECTION", "summary": "A model's claim"},
        ]}
        status, detail, conversation, activity = client.display_snapshot(snapshot)
        self.assertIn("IDLE", status)
        self.assertIn("qwen3.5:2b", detail)
        self.assertIn("James · Android", conversation)
        self.assertIn("James · Debian", conversation)
        self.assertIn("<script>untrusted</script>", conversation)
        self.assertIn("Model summary (unverified)", activity)

    def test_send_uses_existing_local_message_contract_and_disables_proxy(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"accepted":true}'
        opener = Mock()
        opener.open.return_value = response
        payload = {"id": "550e8400-e29b-41d4-a716-446655440000", "content": "hello"}
        with patch.object(client.urllib.request, "ProxyHandler", wraps=client.urllib.request.ProxyHandler) as proxy, patch.object(client.urllib.request, "build_opener", return_value=opener):
            self.assertTrue(client.request("/v1/ui/messages", payload)["accepted"])
        proxy.assert_called_once_with({})
        req = opener.open.call_args.args[0]
        self.assertEqual(req.full_url, "http://127.0.0.1:43131/v1/ui/messages")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(json.loads(req.data), payload)
        with self.assertRaises(ValueError):
            client.request("https://example.com")

    def test_oversized_response_is_rejected(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b"x" * (client.MAX_RESPONSE + 1)
        opener = Mock()
        opener.open.return_value = response
        with patch.object(client.urllib.request, "build_opener", return_value=opener):
            with self.assertRaisesRegex(ValueError, "display limit"):
                client.request("/v1/ui/snapshot")


if __name__ == "__main__":
    unittest.main()
