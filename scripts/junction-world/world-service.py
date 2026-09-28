#!/usr/bin/python3
"""Root-owned Junction World bridge. The public TCP API is fixed and allowlisted."""
import grp
import http.server
import ipaddress
import json
import os
import pathlib
import pwd
import socket
import socketserver
import struct
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from viewer_history import ViewerHistory
from viewer_http import local_message, viewer_request_allowed, viewer_response

PORT = 43130
VIEWER_PORT = 43131
MAX_BODY = 256 * 1024
MAX_AUDIT = 1000
MAX_INFER = 8
MAX_INBOX = 32
MAX_TEXT = 4000
HOST_LEASE_SECONDS = 15
STATE_FILE = "/var/lib/junction-world/service-state.json"
VIEWER_HISTORY_FILE = "/var/lib/junction-world/viewer-history.json"
VIEWER_HISTORY_DEGRADED_FILE = "/var/lib/junction-world/viewer-history-degraded"
VIEWER_ASSET_DIR = "/usr/lib/junction-world/viewer"
SOCKET_PATH = "/run/junction-world/agent.sock"
CATEGORIES = {"WAKE", "SLEEP", "GOAL_CREATED", "GOAL_UPDATED", "GOAL_ABANDONED", "GOAL_COMPLETED", "REFLECTION", "INTENTION", "ACTION", "RESULT", "RESEARCH", "PROJECT_FILE", "COMMUNICATION", "ERROR", "SECURITY_DENIAL", "RESOURCE_WARNING", "SYSTEM"}
DIRECTIONS = {"OWNER_TO_AGENT", "AGENT_TO_OWNER"}
UUID_FIELDS = {"id", "goalId", "actionId", "communicationId", "conversationId"}

def iso_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

def valid_uuid(value):
    try: return str(uuid.UUID(value)) == value.lower()
    except (ValueError, TypeError, AttributeError): return False

def exact(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - (set(required) | set(optional)) or set(required) - set(value):
        raise ValueError("invalid fields")

def validate_event(event):
    exact(event, ("id", "occurredAt", "category", "summary"), ("details", "goalId", "actionId", "actionStatus", "durationMs", "resources", "communicationId", "conversationId", "communicationDirection", "communicationSource"))
    if not valid_uuid(event["id"]): raise ValueError("invalid event id")
    if not isinstance(event["category"], str) or event["category"] not in CATEGORIES: raise ValueError("invalid category")
    if not isinstance(event["summary"], str) or not event["summary"].strip() or len(event["summary"]) > 280: raise ValueError("invalid summary")
    try:
        stamp = datetime.fromisoformat(event["occurredAt"].replace("Z", "+00:00"))
        if stamp.tzinfo is None or stamp.timestamp() < 946684800 or stamp.timestamp() > time.time() + 300: raise ValueError()
    except Exception: raise ValueError("invalid timestamp")
    if "details" in event and (not isinstance(event["details"], str) or len(event["details"]) > MAX_TEXT): raise ValueError("invalid details")
    for key in ("goalId", "actionId", "communicationId", "conversationId"):
        if key in event and not valid_uuid(event[key]): raise ValueError("invalid identifier")
    if "actionStatus" in event and event["actionStatus"] not in {"INTENDED", "ATTEMPTED", "SUCCEEDED", "FAILED", "BLOCKED"}: raise ValueError("invalid action status")
    if "durationMs" in event and (type(event["durationMs"]) is not int or not 0 <= event["durationMs"] <= 900000): raise ValueError("invalid duration")
    if event["category"] == "COMMUNICATION":
        if not all(key in event for key in ("communicationId", "conversationId", "communicationDirection")) or event["communicationDirection"] not in DIRECTIONS: raise ValueError("invalid communication")
        if "communicationSource" in event and event["communicationSource"] not in {"android", "debian"}: raise ValueError("invalid communication source")
    elif any(key in event for key in ("communicationId", "conversationId", "communicationDirection", "communicationSource")): raise ValueError("communication fields on non-communication event")
    if "resources" in event:
        resources = event["resources"]
        exact(resources, (), ("workspaceFreeBytes", "memoryUsedBytes", "cpuPercent"))
        for key in ("workspaceFreeBytes", "memoryUsedBytes"):
            if key in resources and (type(resources[key]) is not int or resources[key] < 0): raise ValueError("invalid resource information")
        if "cpuPercent" in resources and (type(resources["cpuPercent"]) not in {int, float} or not 0 <= resources["cpuPercent"] <= 100): raise ValueError("invalid resource information")
    return event

def valid_inference(value):
    exact(value, ("requestId", "messages", "maxOutputTokens"))
    if not valid_uuid(value["requestId"]) or not isinstance(value["messages"], list) or not 1 <= len(value["messages"]) <= 20: raise ValueError("invalid inference request")
    size = 0
    for message in value["messages"]:
        exact(message, ("role", "content"))
        if message["role"] not in {"system", "user", "assistant"} or not isinstance(message["content"], str) or len(message["content"]) > 8000: raise ValueError("invalid inference message")
        size += len(message["content"].encode())
    if size > 32 * 1024 or type(value["maxOutputTokens"]) is not int or not 16 <= value["maxOutputTokens"] <= 512: raise ValueError("inference limit exceeded")
    return value

class State:
    def __init__(self):
        os.makedirs(os.path.dirname(STATE_FILE), mode=0o700, exist_ok=True)
        self.lock = threading.RLock(); self.changed = threading.Condition(self.lock)
        self.viewer_history = ViewerHistory(VIEWER_HISTORY_FILE)
        self.viewer_history_degraded = self.viewer_history.degraded or os.path.exists(VIEWER_HISTORY_DEGRADED_FILE)
        if self.viewer_history_degraded: self.mark_viewer_history_degraded()
        self.value = {"control": {"paused": True, "heartbeatMinutes": 15, "revision": 0}, "audit": [], "inference": [], "results": {}, "inbox": []}
        try:
            with open(STATE_FILE, encoding="utf8") as stream: saved = json.load(stream)
            if isinstance(saved, dict) and set(saved) == set(self.value): self.value = saved
        except (OSError, ValueError): pass
        heartbeat = self.value.get("control", {}).get("heartbeatMinutes", 15)
        if type(heartbeat) is not int or not 10 <= heartbeat <= 120: heartbeat = 15
        self.value["control"] = {"paused": True, "heartbeatMinutes": heartbeat, "revision": 0}
        self.last_host_control_at = None
        self.runtime = {"status": "PAUSED", "activity": "Waiting for host control", "model": "qwen3.5:2b", "nextWakeAt": None, "startedAt": None}
        self.agent_started_monotonic = None
        self.save()
        self.junction_uid = pwd.getpwnam("junction").pw_uid
        self.junction_gid = grp.getgrnam("junction").gr_gid
        self.wake_lock = threading.Lock(); self.wake_pending = False

    def request_wake(self):
        with self.wake_lock:
            if self.wake_pending: return
            self.wake_pending = True
        def start_when_idle():
            try:
                deadline = time.monotonic() + 300
                while time.monotonic() < deadline:
                    with self.lock:
                        if self.value["control"]["paused"]: return
                    active = subprocess.run(["/usr/bin/systemctl", "is-active", "--quiet", "junction-world-heartbeat.service"], timeout=3, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
                    if not active:
                        subprocess.run(["/usr/bin/systemctl", "start", "--no-block", "junction-world-heartbeat.service"], timeout=8, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        return
                    time.sleep(1)
            finally:
                with self.wake_lock: self.wake_pending = False
        threading.Thread(target=start_when_idle, daemon=True).start()

    def save(self):
        temp = STATE_FILE + ".tmp"
        with open(temp, "w", encoding="utf8") as stream:
            json.dump(self.value, stream, ensure_ascii=False, separators=(",", ":")); stream.flush(); os.fsync(stream.fileno())
        os.chmod(temp, 0o600); os.replace(temp, STATE_FILE)

    def record_viewer_event(self, event):
        try: self.viewer_history.append(event)
        except Exception:
            self.mark_viewer_history_degraded()
            print("Junction World viewer history could not save an event.", file=sys.stderr)

    def mark_viewer_history_degraded(self):
        self.viewer_history_degraded = True
        try:
            with open(VIEWER_HISTORY_DEGRADED_FILE, "w", encoding="ascii") as stream:
                stream.write("History may be incomplete.\n")
            os.chmod(VIEWER_HISTORY_DEGRADED_FILE, 0o600)
        except OSError: pass

    def enqueue_message(self, body, source):
        with self.lock:
            if self.value["control"]["paused"]: return 423, {"accepted": False}
            duplicate = any(item["id"] == body["id"] for item in STATE.value["inbox"])
            if source == "debian" and not duplicate and len(self.value["audit"]) >= MAX_AUDIT: return 429, {"accepted": False}
            if not duplicate:
                if any(item.get("communicationId") == body["id"] for item in self.viewer_history.snapshot()):
                    return 200, {"accepted": True, "duplicate": True}
                if len(STATE.value["inbox"]) >= MAX_INBOX: return 429, {"accepted": False}
                item = dict(body); item["source"] = source
                self.value["inbox"].append(item); self.save()
            viewer_event = {"id": body["id"], "occurredAt": iso_now(), "category": "COMMUNICATION",
                "summary": "Message sent to Junction World from Debian local chat." if source == "debian" else "Message sent to Junction World from Android.",
                "details": body["content"], "communicationId": body["id"], "conversationId": body["conversationId"],
                "communicationDirection": "OWNER_TO_AGENT", "communicationSource": source}
            self.record_viewer_event(viewer_event)
            # Android already records Android-source owner messages in its host store.
            # Debian-local messages originate here, so mirror them through the existing
            # authenticated audit queue for the same Android conversation.
            if source == "debian":
                self.value["audit"].append(viewer_event); self.save()
        self.request_wake()
        return 200, {"accepted": True}

    def update_runtime(self, value):
        exact(value, ("status", "activity"), ("model", "nextWakeAt"))
        if value["status"] not in {"ACTIVE", "WORKING", "IDLE", "SLEEPING", "PAUSED", "ERROR", "STOPPED"}: raise ValueError("invalid runtime status")
        if not isinstance(value["activity"], str) or len(value["activity"]) > 200: raise ValueError("invalid activity")
        model = value.get("model", self.runtime.get("model", "qwen3.5:2b"))
        if not isinstance(model, str) or len(model) > 80: raise ValueError("invalid model")
        next_wake = value.get("nextWakeAt", self.runtime.get("nextWakeAt"))
        if next_wake is not None and (type(next_wake) not in (int, float) or next_wake < 0): raise ValueError("invalid next wake")
        with self.lock:
            if self.agent_started_monotonic is None:
                self.agent_started_monotonic = time.monotonic()
                self.runtime["startedAt"] = iso_now()
            paused = self.value["control"]["paused"]
            self.runtime.update({"status": "PAUSED" if paused else value["status"], "activity": "Paused by James" if paused else value["activity"], "model": model, "nextWakeAt": next_wake})
        return {"accepted": True}

    def runtime_snapshot(self):
        with self.lock:
            result = dict(self.runtime)
            result["uptimeSeconds"] = int(time.monotonic() - self.agent_started_monotonic) if self.agent_started_monotonic is not None else 0
            return result

    def apply_control(self, headers):
        paused = headers.get("X-Junction-Paused")
        heartbeat = headers.get("X-Junction-Heartbeat-Minutes")
        revision = headers.get("X-Junction-Control-Revision")
        if paused not in {"0", "1"} or not heartbeat or not revision: raise ValueError("invalid host control")
        minutes, rev = int(heartbeat), int(revision)
        if not 10 <= minutes <= 120 or rev < self.value["control"]["revision"]: raise ValueError("stale host control")
        previous = self.value["control"]
        current = {"paused": paused == "1", "heartbeatMinutes": minutes, "revision": rev}
        changed = previous != current
        with self.changed:
            self.last_host_control_at = time.monotonic()
            if changed:
                self.value["control"] = current
                if len(self.value["audit"]) < MAX_AUDIT:
                    event = {"id": str(uuid.uuid4()), "occurredAt": iso_now(), "category": "SYSTEM", "summary": "Host paused Junction World." if current["paused"] else "Host resumed Junction World.", "details": "Heartbeat interval: " + str(minutes) + " minutes."}
                    self.value["audit"].append(event); self.record_viewer_event(event)
                self.save()
            self.changed.notify_all()
        if current["paused"]:
            with self.lock:
                self.runtime["status"] = "PAUSED"
                self.runtime["activity"] = "Paused by James"
        elif changed:
            self.request_wake()
        return current

    def schedule(self):
        while True:
            with self.changed:
                control = self.value["control"]
                if self.last_host_control_at is None or time.monotonic() - self.last_host_control_at > HOST_LEASE_SECONDS:
                    if not control["paused"]:
                        self.value["control"] = {**control, "paused": True}
                        self.runtime["status"] = "PAUSED"
                        self.runtime["activity"] = "Paused because the Windows control relay lease expired"
                        if len(self.value["audit"]) < MAX_AUDIT:
                            event = {"id": str(uuid.uuid4()), "occurredAt": iso_now(), "category": "SECURITY_DENIAL", "summary": "Paused Junction World because the Windows control relay heartbeat expired.", "actionStatus": "BLOCKED"}
                            self.value["audit"].append(event); self.record_viewer_event(event)
                        self.save()
                        self.save(); self.changed.notify_all()
                self.changed.wait(3)

STATE = State()

class Http(http.server.BaseHTTPRequestHandler):
    server_version = "JunctionWorld/1"
    def log_message(self, _format, *_args): pass
    def reply(self, status, data):
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Cache-Control", "no-store"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def read_body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= MAX_BODY: raise ValueError("invalid body size")
        data = json.loads(self.rfile.read(size))
        if not isinstance(data, dict): raise ValueError("invalid body")
        return data
    def do_GET(self):
        if self.path != "/v1/poll": return self.reply(404, {"error": "unavailable"})
        try: self.server.state.apply_control(self.headers)
        except (ValueError, TypeError): return self.reply(400, {"error": "invalid control"})
        with STATE.lock:
            audit_events = []
            for event in STATE.value["audit"][:100]:
                # Keep the existing authenticated Windows relay event contract unchanged.
                relay_event = {key: value for key, value in event.items() if key != "communicationSource"}
                candidate = audit_events + [relay_event]
                if len(json.dumps(candidate, ensure_ascii=False, separators=(",", ":")).encode()) > 72 * 1024: break
                audit_events = candidate
            inference_requests = []
            for request in STATE.value["inference"][:4]:
                candidate = inference_requests + [request]
                if len(json.dumps(candidate, ensure_ascii=False, separators=(",", ":")).encode()) > 150 * 1024: break
                inference_requests = candidate
            return self.reply(200, {"auditEvents": audit_events, "inferenceRequests": inference_requests})
    def do_POST(self):
        try: body = self.read_body()
        except Exception: return self.reply(400, {"error": "invalid request"})
        try:
            if self.path == "/v1/control":
                exact(body, ())
                self.server.state.apply_control(self.headers)
                return self.reply(200, {"accepted": True})
            if self.path == "/v1/messages":
                exact(body, ("id", "conversationId", "deviceId", "content"))
                if not valid_uuid(body["id"]) or not valid_uuid(body["conversationId"]) or not isinstance(body["deviceId"], str) or len(body["deviceId"]) > 128 or not isinstance(body["content"], str) or not body["content"].strip() or len(body["content"]) > 2800: raise ValueError()
                status, response = self.server.state.enqueue_message(body, "android")
                return self.reply(status, response)
            if self.path == "/v1/inference-result":
                exact(body, ("requestId", "status", "response"))
                if not valid_uuid(body["requestId"]) or type(body["status"]) is not int or not 100 <= body["status"] <= 599 or not isinstance(body["response"], dict) or len(json.dumps(body["response"])) > 20_000: raise ValueError()
                with STATE.changed:
                    STATE.value["results"][body["requestId"]] = body; STATE.value["inference"] = [item for item in STATE.value["inference"] if item["requestId"] != body["requestId"]]
                    if len(STATE.value["results"]) > 16: STATE.value["results"].pop(next(iter(STATE.value["results"])))
                    STATE.save(); STATE.changed.notify_all()
                return self.reply(200, {"accepted": True})
            if self.path == "/v1/audit/ack":
                exact(body, ("ids",))
                if not isinstance(body["ids"], list) or len(body["ids"]) > 100 or any(not valid_uuid(value) for value in body["ids"]): raise ValueError()
                wanted = set(body["ids"])
                with STATE.lock: STATE.value["audit"] = [event for event in STATE.value["audit"] if event["id"] not in wanted]; STATE.save()
                return self.reply(200, {"acknowledged": True})
        except Exception: return self.reply(400, {"error": "invalid request"})
        return self.reply(404, {"error": "unavailable"})

class ViewerHttp(http.server.BaseHTTPRequestHandler):
    server_version = "JunctionWorldViewer/1"
    def log_message(self, _format, *_args): pass
    def do_GET(self):
        if not viewer_request_allowed(self.headers.get("Host"), self.headers.get("Origin")): return self.send_error(404)
        if self.path == "/v1/ui/diary":
            files = sorted(pathlib.Path("/home/junction/junction/diary").glob("*.md"))
            chunks = []
            size = 0
            for path in reversed(files[-40:]):
                try: data = path.read_text(encoding="utf8", errors="replace")[-8000:]
                except OSError: continue
                if size + len(data) > 24_000: data = data[-(24_000 - size):]
                chunks.append(data); size += len(data)
                if size >= 24_000: break
            raw = json.dumps({"content": "\n".join(reversed(chunks))}, ensure_ascii=False).encode("utf8")
            self.send_response(200); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Cache-Control", "no-store"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)
            return
        with self.server.state.lock: control = dict(self.server.state.value["control"])
        control.update(self.server.state.runtime_snapshot())
        control["historyDegraded"] = self.server.state.viewer_history_degraded
        result = viewer_response("GET", self.path, self.server.state.viewer_history, control, VIEWER_ASSET_DIR)
        if result is None: return self.send_error(404)
        status, headers, raw = result
        self.send_response(status)
        for name, value in headers.items(): self.send_header(name, value)
        self.end_headers(); self.wfile.write(raw)
    def do_POST(self):
        if not viewer_request_allowed(self.headers.get("Host"), self.headers.get("Origin")): return self.send_error(404)
        if self.path != "/v1/ui/messages": return self.send_error(404)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 1 <= size <= 4096: raise ValueError("invalid body")
            body = json.loads(self.rfile.read(size))
            message = local_message(body, self.server.state.value["control"]["paused"])
            status, response = self.server.state.enqueue_message(message, "debian")
        except ValueError as error:
            status, response = (423 if "paused" in str(error) else 400), {"accepted": False, "error": str(error)[:80]}
        except Exception:
            status, response = 400, {"accepted": False, "error": "invalid message"}
        raw = json.dumps(response, separators=(",", ":")).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Cache-Control", "no-store"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

class UnixRpc(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    def __init__(self, address, state): self.state = state; super().__init__(address, Rpc)

class Rpc(socketserver.StreamRequestHandler):
    def handle(self):
        peer = self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")); _pid, uid, _gid = struct.unpack("3i", peer)
        if uid != STATE.junction_uid: return
        self.request.settimeout(135)
        raw = self.rfile.readline(32 * 1024 + 1)
        try:
            if len(raw) > 32 * 1024: raise ValueError("request too large")
            req = json.loads(raw)
            if not isinstance(req, dict): raise ValueError("invalid request")
            response = self.run(req)
            self.wfile.write(json.dumps({"ok": True, "result": response}, ensure_ascii=False, separators=(",", ":")).encode() + b"\n")
        except Exception as error:
            safe = str(error)[:160]
            self.wfile.write(json.dumps({"ok": False, "error": safe}).encode() + b"\n")

    def run(self, req):
        op = req.get("op")
        if op == "audit":
            exact(req, ("op", "event")); event = validate_event(req["event"])
            with STATE.lock:
                if any(item["id"] == event["id"] for item in STATE.value["audit"]): return {"duplicate": True}
                if len(STATE.value["audit"]) >= MAX_AUDIT: raise ValueError("audit queue full")
                STATE.record_viewer_event(event)
                STATE.value["audit"].append(event); STATE.save()
            return {"accepted": True}
        if op == "infer":
            exact(req, ("op", "request")); request = valid_inference(req["request"])
            with STATE.changed:
                if STATE.value["control"]["paused"]: raise ValueError("Junction World is paused")
                if len(STATE.value["inference"]) >= MAX_INFER: raise ValueError("inference queue full")
                STATE.value["inference"].append(request); STATE.save()
                deadline = time.monotonic() + 125
                while request["requestId"] not in STATE.value["results"] and time.monotonic() < deadline:
                    if STATE.value["control"]["paused"]:
                        STATE.value["inference"] = [item for item in STATE.value["inference"] if item["requestId"] != request["requestId"]]
                        STATE.save(); raise ValueError("Junction World was paused during inference")
                    STATE.changed.wait(min(2, deadline - time.monotonic()))
                result = STATE.value["results"].pop(request["requestId"], None); STATE.save()
            if result is None: raise TimeoutError("inference timed out")
            if result["status"] != 200: raise RuntimeError("local inference was unavailable")
            content = result["response"].get("content")
            if not isinstance(content, str) or len(content) > 16_000: raise ValueError("invalid inference response")
            return {"content": content, "model": "qwen3.5:2b"}
        if op == "messages":
            exact(req, ("op",))
            with STATE.lock: return list(STATE.value["inbox"][:8])
        if op == "ack-message":
            exact(req, ("op", "id"))
            if not valid_uuid(req["id"]): raise ValueError("invalid message id")
            with STATE.lock: STATE.value["inbox"] = [item for item in STATE.value["inbox"] if item["id"] != req["id"]]; STATE.save()
            return {"accepted": True}
        if op == "run-code":
            exact(req, ("op", "path"))
            relative = req["path"]
            if not isinstance(relative, str) or len(relative) > 240 or relative.startswith("/") or ".." in relative.split("/") or not (relative.startswith("projects/") or relative.startswith("self/")) or not relative.endswith(".py"):
                raise ValueError("invalid project execution path")
            workspace = "/home/junction/junction"
            root = os.path.join(workspace, relative.split("/", 1)[0])
            target = os.path.realpath(os.path.join("/home/junction/junction", relative))
            if os.path.commonpath([root, target]) != root or not os.path.isfile(target) or os.path.islink(os.path.join("/home/junction/junction", relative)) or os.path.getsize(target) > 32_000:
                raise ValueError("project file unavailable")
            unit = "junction-world-code-" + str(uuid.uuid4()).replace("-", "")[:20]
            command = ["/usr/bin/systemd-run", "--quiet", "--wait", "--pipe", "--collect", "--unit=" + unit,
                "--uid=junction-code", "--working-directory=" + root, "--setenv=PATH=/usr/bin:/bin", "--setenv=LANG=C.UTF-8", "--setenv=TMPDIR=/tmp",
                "--property=PartOf=junction-world-heartbeat.service",
                "--property=RuntimeMaxSec=20", "--property=MemoryMax=384M", "--property=CPUQuota=80%", "--property=TasksMax=24",
                "--property=LimitCPU=15", "--property=LimitFSIZE=33554432", "--property=LimitNOFILE=64", "--property=LimitNPROC=24",
                "--property=NoNewPrivileges=yes", "--property=PrivateDevices=yes", "--property=PrivateNetwork=yes",
                "--property=ProtectSystem=strict", "--property=ProtectKernelTunables=yes", "--property=ProtectKernelModules=yes", "--property=ProtectControlGroups=yes",
                "--property=ProtectProc=invisible", "--property=ProcSubset=pid", "--property=RestrictAddressFamilies=AF_UNIX", "--property=RestrictNamespaces=yes", "--property=RestrictRealtime=yes", "--property=RestrictSUIDSGID=yes", "--property=LockPersonality=yes",
                "--property=CapabilityBoundingSet=", "--property=TemporaryFileSystem=/tmp:size=32M,mode=1777", "--property=TemporaryFileSystem=/var/tmp:size=8M,mode=1777",
                "--property=TemporaryFileSystem=/dev/shm:size=8M,mode=1777", "--property=TemporaryFileSystem=/home/junction/junction/projects/.junction-run:size=64M,mode=1777",
                "--", "/usr/bin/python3", "-I", "-B", target]
            proc = subprocess.Popen(command, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=False, env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"})
            output = bytearray(); output_lock = threading.Lock()
            def collect():
                while True:
                    chunk = proc.stdout.read(4096)
                    if not chunk: return
                    with output_lock:
                        output.extend(chunk)
                        if len(output) > 8192: del output[:-8192]
            reader = threading.Thread(target=collect, daemon=True); reader.start()
            try: proc.wait(timeout=25)
            except subprocess.TimeoutExpired:
                subprocess.run(["/usr/bin/systemctl", "stop", unit + ".service"], timeout=5, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                proc.kill(); proc.wait(timeout=3)
                return {"exitCode": 124, "output": bytes(output).decode("utf8", "replace")[-2000:], "timedOut": True}
            reader.join(timeout=2)
            return {"exitCode": proc.returncode, "output": bytes(output).decode("utf8", "replace")[-2000:], "timedOut": False}
        if op == "control":
            exact(req, ("op",))
            with STATE.lock: return dict(STATE.value["control"])
        if op == "runtime-status":
            exact(req, ("op", "status", "activity"), ("model", "nextWakeAt"))
            return STATE.update_runtime({key: value for key, value in req.items() if key != "op"})
        if op == "research":
            exact(req, ("op", "query"))
            query = req["query"]
            words = query.strip().split() if isinstance(query, str) else []
            if not isinstance(query, str) or not 3 <= len(query.strip()) <= 160 or not 1 <= len(words) <= 12 or any(len(word) > 24 for word in words) or any(not (char.isalnum() or char.isspace() or char in "-_") for char in query): raise ValueError("invalid public research query")
            addresses = sorted({entry[4][0] for entry in socket.getaddrinfo("en.wikipedia.org", 443, socket.AF_INET, socket.SOCK_STREAM) if ipaddress.ip_address(entry[4][0]).is_global})
            if not addresses: raise RuntimeError("public research address unavailable")
            for address in addresses:
                subprocess.run(["/usr/sbin/nft", "add", "element", "inet", "junction_world", "research_ipv4", "{", address, "timeout", "30s", "}"], timeout=3, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            completed = subprocess.run(["/usr/sbin/runuser", "-u", "junction-research", "--", "/usr/bin/python3", "/usr/lib/junction-world/research-broker.py"], input=json.dumps({"query": query.strip(), "addresses": addresses}), text=True, capture_output=True, timeout=18, check=False, env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})
            if completed.returncode != 0: raise RuntimeError("public research request failed")
            return json.loads(completed.stdout)
        raise ValueError("operation unavailable")

def main():
    os.makedirs(os.path.dirname(SOCKET_PATH), mode=0o750, exist_ok=True)
    try: os.unlink(SOCKET_PATH)
    except FileNotFoundError: pass
    rpc = UnixRpc(SOCKET_PATH, STATE); os.chown(SOCKET_PATH, 0, STATE.junction_gid); os.chmod(SOCKET_PATH, 0o660)
    threading.Thread(target=rpc.serve_forever, daemon=True).start()
    threading.Thread(target=STATE.schedule, daemon=True).start()
    viewer = http.server.ThreadingHTTPServer(("127.0.0.1", VIEWER_PORT), ViewerHttp); viewer.state = STATE; viewer.daemon_threads = True
    threading.Thread(target=viewer.serve_forever, daemon=True).start()
    subprocess.run(["/usr/bin/systemctl", "start", "--no-block", "junction-world-heartbeat.service"], timeout=5, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Http); server.state = STATE; server.daemon_threads = True
    server.serve_forever(poll_interval=1)

if __name__ == "__main__": main()
