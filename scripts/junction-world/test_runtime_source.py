"""Source-level checks for the Linux runtime that can run on Windows CI."""
import ast
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parent


class RuntimeSourceTest(unittest.TestCase):
    def test_viewer_routes_are_fixed_loopback_and_share_runtime_status(self):
        source = (ROOT / "world-service.py").read_text(encoding="utf8")
        http_source = (ROOT / "viewer_http.py").read_text(encoding="utf8")
        for route in ('"/ui"', '"/ui.css"', '"/ui.js"', '"/v1/ui/snapshot"'):
            self.assertIn(route, http_source)
        self.assertIn("from viewer_http import local_message, viewer_request_allowed, viewer_response", source)
        self.assertIn('class ViewerHttp(http.server.BaseHTTPRequestHandler):', source)
        self.assertIn('("127.0.0.1", VIEWER_PORT)', source)
        self.assertIn('self.path != "/v1/ui/messages"', source)
        self.assertIn('self.path == "/v1/ui/diary"', source)
        self.assertIn("viewer_request_allowed(self.headers.get(\"Host\"), self.headers.get(\"Origin\"))", source)
        self.assertNotIn('viewer_response("GET", self.path', source.split('class Http(', 1)[1].split('class ViewerHttp(', 1)[0])
        self.assertIn("history.snapshot()", http_source)
        self.assertIn('"paused": paused', http_source)
        self.assertIn('"heartbeatMinutes": heartbeat_minutes', http_source)
        self.assertIn('"events": events', http_source)
        self.assertIn('"historyDegraded": history_degraded', http_source)
        self.assertIn('"status": "PAUSED" if paused else status', http_source)
        self.assertIn('"Cache-Control": "no-store"', http_source)
        self.assertIn('"X-Content-Type-Options": "nosniff"', http_source)

    def test_viewer_uses_safe_text_nodes_and_shared_message_controls(self):
        page = ROOT / "viewer" / "index.html"
        script = ROOT / "viewer" / "viewer.js"
        self.assertTrue(page.is_file(), "viewer page is missing")
        self.assertTrue(script.is_file(), "viewer script is missing")
        html = page.read_text(encoding="utf8")
        javascript = script.read_text(encoding="utf8")
        self.assertIn("/ui.css", html)
        self.assertIn("/ui.js", html)
        self.assertIn("/v1/ui/snapshot", javascript)
        self.assertIn("textContent", javascript)
        self.assertNotIn("innerHTML", javascript)
        self.assertIn("<input", html.lower())
        self.assertIn("<form", html.lower())
        self.assertIn("/v1/ui/messages", javascript)
        self.assertIn("crypto.randomUUID()", javascript)
        self.assertNotIn("innerHTML", javascript)

    def test_viewer_launcher_and_guest_installation_are_bounded(self):
        source = (ROOT / "harden-guest.sh").read_text(encoding="utf8")
        self.assertIn("viewer_history.py", source)
        self.assertIn("viewer_http.py", source)
        self.assertIn("junction-world-viewer.desktop", source)
        self.assertIn("viewer/index.html", source)
        self.assertIn("viewer/viewer.css", source)
        self.assertIn("viewer/viewer.js", source)

        launcher_path = ROOT / "open-viewer.sh"
        desktop_path = ROOT / "junction-world-viewer.desktop"
        updater_path = ROOT / "update-guest-runtime.sh"
        self.assertTrue(launcher_path.is_file(), "viewer launcher is missing")
        self.assertTrue(desktop_path.is_file(), "desktop entry is missing")
        self.assertTrue(updater_path.is_file(), "safe existing-VM updater is missing")
        launcher = launcher_path.read_text(encoding="utf8")
        desktop = desktop_path.read_text(encoding="utf8")
        updater = updater_path.read_text(encoding="utf8")
        iso_builder = (ROOT.parent / "windows" / "New-JunctionWorldProvisioningIso.ps1").read_text(encoding="utf8")
        self.assertIn("--new-window", launcher)
        self.assertIn("firefox-esr", launcher)
        self.assertIn("chromium", launcher)
        self.assertNotIn("--kiosk", launcher)
        self.assertNotIn("--no-sandbox", launcher)
        self.assertIn("Terminal=false", desktop)
        self.assertIn("junction-world-viewer", desktop)
        self.assertIn("sha256sum -c SHA256SUMS", updater)
        self.assertIn("systemctl restart junction-world.service", updater)
        self.assertIn("127.0.0.1:43131/v1/ui/snapshot", updater)
        self.assertIn("trap rollback EXIT", updater)
        self.assertNotIn("nftables.service", updater)
        for required_file in ("viewer_history.py", "viewer_http.py", "open-viewer.sh", "update-guest-runtime.sh", "junction-cli.py", "persistent_runtime.py", "junction-world-tmpfiles.conf", "junction-world-viewer.desktop"):
            self.assertIn(required_file, iso_builder)
        self.assertIn("'viewer') -Destination $Stage -Recurse", iso_builder)
        self.assertIn("-File -Recurse", iso_builder)
        self.assertIn("$RelativePath", iso_builder)

    def test_android_messages_and_guest_audit_events_enter_viewer_history(self):
        source = (ROOT / "world-service.py").read_text(encoding="utf8")
        self.assertIn("from viewer_history import ViewerHistory", source)
        self.assertIn("VIEWER_HISTORY_FILE = \"/var/lib/junction-world/viewer-history.json\"", source)

        http = next(node for node in ast.parse(source).body if isinstance(node, ast.ClassDef) and node.name == "Http")
        post = next(node for node in http.body if isinstance(node, ast.FunctionDef) and node.name == "do_POST")
        post_source = ast.get_source_segment(source, post)
        self.assertIn('self.path == "/v1/messages"', post_source)
        self.assertIn('enqueue_message(body, "android")', post_source)
        state = next(node for node in ast.parse(source).body if isinstance(node, ast.ClassDef) and node.name == "State")
        enqueue = next(node for node in state.body if isinstance(node, ast.FunctionDef) and node.name == "enqueue_message")
        enqueue_source = ast.get_source_segment(source, enqueue)
        self.assertIn("record_viewer_event(viewer_event)", enqueue_source)
        self.assertIn('if source == "debian":', enqueue_source)
        self.assertIn('self.value["audit"].append(viewer_event)', enqueue_source)
        self.assertLess(enqueue_source.index("record_viewer_event(viewer_event)"), enqueue_source.index("request_wake"))
        poll_source = ast.get_source_segment(source, next(node for node in next(node for node in ast.parse(source).body if isinstance(node, ast.ClassDef) and node.name == "Http").body if isinstance(node, ast.FunctionDef) and node.name == "do_GET"))
        self.assertIn('key != "communicationSource"', poll_source)
        self.assertIn("lastWakeIndex > lastSleepIndex", (ROOT / "viewer" / "viewer.js").read_text(encoding="utf8"))
        self.assertIn("previous protected files", (ROOT / "update-guest-runtime.sh").read_text(encoding="utf8"))

        rpc = next(node for node in ast.parse(source).body if isinstance(node, ast.ClassDef) and node.name == "Rpc")
        run = next(node for node in rpc.body if isinstance(node, ast.FunctionDef) and node.name == "run")
        run_source = ast.get_source_segment(source, run)
        self.assertIn('if op == "audit"', run_source)
        self.assertIn("STATE.record_viewer_event", run_source)
        self.assertIn("self.record_viewer_event(event)", source)

    def test_root_supervisor_restart_failures_are_rate_limited(self):
        unit = (ROOT / "junction-world.service").read_text(encoding="utf8")
        self.assertIn("StartLimitIntervalSec=300s", unit)
        self.assertIn("StartLimitBurst=5", unit)
        self.assertIn("RestartSec=30", unit)

    def test_persistent_loop_waits_for_events_and_has_no_bounded_wake_deadline(self):
        source = ast.parse((ROOT / "world-service.py").read_text(encoding="utf8"))
        agent = (ROOT / "agent.py").read_text(encoding="utf8")
        unit = (ROOT / "junction-world-heartbeat.service").read_text(encoding="utf8")
        self.assertIn("while True:", agent)
        self.assertIn("SCHEDULER.due_tasks()", agent)
        self.assertNotIn("MAX_WALL_SECONDS", agent)
        self.assertNotIn("RuntimeMaxSec=", unit)
        self.assertNotIn("TimeoutStartSec=", unit)
        self.assertIn("Restart=on-failure", unit)
        self.assertIn("sys.path.insert(0", agent)
        self.assertIn("MAX_WORKSPACE_BYTES = 8 * 1024 * 1024 * 1024", agent)
        self.assertIn("StartLimitIntervalSec=300s", unit.split("[Service]", 1)[0])


if __name__ == "__main__":
    unittest.main()
