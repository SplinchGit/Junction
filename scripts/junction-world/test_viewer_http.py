"""Loopback HTTP tests for the guest viewer's fixed read-only routes."""
import http.server
import importlib.util
import json
import pathlib
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from test_viewer_history import communication, load_history_type


ROOT = pathlib.Path(__file__).resolve().parent
MODULE_PATH = ROOT / "viewer_http.py"


def load_response_function():
    if not MODULE_PATH.is_file():
        raise AssertionError("viewer_http.py has not been implemented")
    spec = importlib.util.spec_from_file_location("junction_world_viewer_http", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load viewer_http.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.viewer_response


class ViewerHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

    def do_GET(self):
        result = self.server.response_function(
            "GET", self.path, self.server.viewer_history,
            self.server.viewer_control, self.server.viewer_assets,
        )
        if result is None:
            self.send_error(404)
            return
        status, headers, body = result
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        result = self.server.response_function(
            "POST", self.path, self.server.viewer_history,
            self.server.viewer_control, self.server.viewer_assets,
        )
        self.send_error(404 if result is None else result[0])


class ViewerHttpTest(unittest.TestCase):
    def setUp(self):
        self.viewer_response = load_response_function()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.assets = pathlib.Path(self.directory.name) / "viewer"
        self.assets.mkdir()
        (self.assets / "index.html").write_text("<h1>Junction World</h1>", encoding="utf8")
        (self.assets / "viewer.css").write_text("body { color: white; }", encoding="utf8")
        (self.assets / "viewer.js").write_text("document.body.textContent = 'ready';", encoding="utf8")
        history_type = load_history_type()
        self.history = history_type(pathlib.Path(self.directory.name) / "history.json")
        self.history.append(communication(
            "750e8400-e29b-41d4-a716-446655440001",
            "750e8400-e29b-41d4-a716-446655440002",
            "AGENT_TO_OWNER",
            "Reply shown in Audit.",
        ))
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), ViewerHandler)
        self.server.response_function = self.viewer_response
        self.server.viewer_history = self.history
        self.server.viewer_control = {"paused": False, "heartbeatMinutes": 15, "revision": 5}
        self.server.viewer_assets = self.assets
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.thread.join)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def request(self, route):
        with urllib.request.urlopen(self.base_url + route, timeout=3) as response:
            return response.status, response.headers, response.read()

    def test_page_and_static_assets_are_served_without_caching(self):
        status, headers, body = self.request("/ui")
        self.assertEqual(status, 200)
        self.assertIn("Junction World", body.decode("utf8"))
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        for route, expected_type in (("/ui.css", "text/css"), ("/ui.js", "text/javascript")):
            status, headers, _body = self.request(route)
            self.assertEqual(status, 200)
            self.assertIn(expected_type, headers["Content-Type"])

    def test_snapshot_has_only_status_and_display_safe_events(self):
        _status, headers, body = self.request("/v1/ui/snapshot")
        payload = json.loads(body)
        self.assertEqual(set(payload), {"paused", "heartbeatMinutes", "historyDegraded", "status", "activity", "model", "uptimeSeconds", "nextWakeAt", "startedAt", "updatedAt", "events"})
        self.assertFalse(payload["paused"])
        self.assertEqual(payload["heartbeatMinutes"], 15)
        self.assertFalse(payload["historyDegraded"])
        self.assertEqual(payload["events"][0]["message"], "Reply shown in Audit.")
        self.assertEqual(payload["status"], "IDLE")
        self.assertEqual(payload["model"], "qwen3.5:2b")
        self.assertNotIn("details", payload["events"][0])
        self.assertNotIn("inference", payload)
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_snapshot_is_get_only_and_unknown_paths_are_not_served(self):
        with self.assertRaises(urllib.error.HTTPError) as post_error:
            request = urllib.request.Request(self.base_url + "/v1/ui/snapshot", data=b"{}", method="POST")
            urllib.request.urlopen(request, timeout=3)
        self.assertEqual(post_error.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as missing_error:
            urllib.request.urlopen(self.base_url + "/v1/ui/snapshot/extra", timeout=3)
        self.assertEqual(missing_error.exception.code, 404)
        self.assertFalse(self.server.viewer_control["paused"])
        self.assertEqual(self.server.viewer_control["revision"], 5)

    def test_origin_guard_rejects_dns_rebinding_hosts_and_foreign_origins(self):
        spec = importlib.util.spec_from_file_location("junction_world_viewer_http_guard", MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        allowed = module.viewer_request_allowed
        self.assertTrue(allowed("127.0.0.1:43131", None))
        self.assertTrue(allowed("127.0.0.1:43131", "http://127.0.0.1:43131"))
        self.assertFalse(allowed("attacker.example:43131", "http://attacker.example:43131"))
        self.assertFalse(allowed("127.0.0.1:43131", "https://attacker.example"))

    def test_local_chat_message_has_same_shared_conversation_metadata(self):
        path = pathlib.Path(__file__).resolve().parent / "viewer_http.py"
        spec = importlib.util.spec_from_file_location("junction_world_local_chat", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        message = module.local_message({"id": "750e8400-e29b-41d4-a716-446655440011", "content": "hello from Debian"}, False)
        self.assertEqual(message["source"], "debian")
        self.assertEqual(message["conversationId"], "550e8400-e29b-41d4-a716-446655440000")
        self.assertEqual(message["content"], "hello from Debian")

    def test_local_chat_rejects_paused_or_malformed_message(self):
        spec = importlib.util.spec_from_file_location("junction_world_local_chat_paused", MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaises(ValueError):
            module.local_message({"id": "750e8400-e29b-41d4-a716-446655440011", "content": "hello"}, True)
        with self.assertRaises(ValueError):
            module.local_message({"id": "nope", "content": "hello"}, False)


if __name__ == "__main__":
    unittest.main()
