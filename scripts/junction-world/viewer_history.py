"""Bounded, display-safe conversation history for the Debian local viewer."""
import datetime
import json
import os
import pathlib
import re
import tempfile
import threading
import uuid


MAX_VIEWER_ITEMS = 200
MAX_VIEWER_BYTES = 512 * 1024
MAX_VIEWER_RESPONSE_BYTES = 256 * 1024 - 512
MAX_MESSAGE_CHARS = 2000
MAX_SUMMARY_CHARS = 280
_COMMUNICATION_DIRECTIONS = {"OWNER_TO_AGENT", "AGENT_TO_OWNER"}
_ACTION_STATUSES = {"INTENDED", "ATTEMPTED", "SUCCEEDED", "FAILED", "BLOCKED"}
_CATEGORIES = {
    "WAKE", "SLEEP", "GOAL_CREATED", "GOAL_UPDATED", "GOAL_ABANDONED",
    "GOAL_COMPLETED", "REFLECTION", "INTENTION", "ACTION", "RESULT",
    "RESEARCH", "PROJECT_FILE", "COMMUNICATION", "ERROR", "SECURITY_DENIAL",
    "RESOURCE_WARNING", "SYSTEM",
}
_UUID_PATTERN = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _is_uuid(value):
    if not isinstance(value, str) or not _UUID_PATTERN.fullmatch(value):
        return False
    try:
        return str(uuid.UUID(value)) == value.lower()
    except ValueError:
        return False


def _valid_timestamp(value):
    if not isinstance(value, str) or len(value) > 64:
        return False
    try:
        stamp = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return stamp.tzinfo is not None
    except ValueError:
        return False


class ViewerHistory:
    """Keep only bounded messages and high-level activity approved for display."""

    def __init__(self, path, max_items=MAX_VIEWER_ITEMS, max_bytes=MAX_VIEWER_BYTES):
        if type(max_items) is not int or max_items < 1:
            raise ValueError("max_items must be a positive integer")
        if type(max_bytes) is not int or max_bytes < 128:
            raise ValueError("max_bytes must be at least 128")
        self.path = pathlib.Path(path)
        self.max_items = max_items
        self.max_bytes = max_bytes
        self._lock = threading.RLock()
        self.degraded = False
        self._items = self._load()

    @staticmethod
    def _normalize(event):
        if not isinstance(event, dict):
            raise ValueError("event must be an object")
        category = event.get("category")
        if not isinstance(category, str) or category not in _CATEGORIES:
            raise ValueError("unsupported viewer event category")
        if not _valid_timestamp(event.get("occurredAt")):
            raise ValueError("invalid viewer event timestamp")
        summary = event.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            raise ValueError("invalid viewer event summary")

        if category == "COMMUNICATION":
            communication_id = event.get("communicationId")
            conversation_id = event.get("conversationId")
            direction = event.get("communicationDirection")
            message = event.get("message", event.get("details"))
            if not _is_uuid(communication_id) or not _is_uuid(conversation_id):
                raise ValueError("invalid viewer communication ID")
            if not isinstance(direction, str) or direction not in _COMMUNICATION_DIRECTIONS or not isinstance(message, str):
                raise ValueError("invalid viewer communication")
            if not _is_uuid(event.get("id")):
                raise ValueError("invalid viewer event ID")
            message = message.encode("utf8", "replace").decode("utf8")
            if len(message) > MAX_MESSAGE_CHARS:
                message = message[:MAX_MESSAGE_CHARS - 1] + "…"
            record = {
                "id": communication_id,
                "occurredAt": event["occurredAt"],
                "category": category,
                "summary": summary.encode("utf8", "replace").decode("utf8")[:MAX_SUMMARY_CHARS],
                "communicationId": communication_id,
                "conversationId": conversation_id,
                "communicationDirection": direction,
                "message": message,
                "source": event.get("communicationSource", "android"),
            }
            if record["source"] not in {"android", "debian"}:
                record["source"] = "android"
        else:
            event_id = event.get("id")
            if not _is_uuid(event_id):
                raise ValueError("invalid viewer event ID")
            record = {
                "id": event_id,
                "occurredAt": event["occurredAt"],
                "category": category,
                "summary": summary.encode("utf8", "replace").decode("utf8")[:MAX_SUMMARY_CHARS],
            }

        status = event.get("actionStatus")
        if isinstance(status, str) and status in _ACTION_STATUSES:
            record["actionStatus"] = status
        duration = event.get("durationMs")
        if type(duration) is int and 0 <= duration <= 900000:
            record["durationMs"] = duration
        return record

    @staticmethod
    def _serialized(items):
        return json.dumps(items, ensure_ascii=False, separators=(",", ":")).encode("utf8")

    def _fit(self, items, limit_items, limit_bytes):
        kept = []
        size = 2  # JSON array brackets.
        for item in reversed(items):
            encoded_size = len(self._serialized(item))
            added_size = encoded_size + (1 if kept else 0)
            if len(kept) >= limit_items or size + added_size > limit_bytes:
                continue
            kept.append(item)
            size += added_size
        kept.reverse()
        return kept

    def _load(self):
        try:
            raw = self.path.read_bytes()
            if len(raw) > self.max_bytes:
                self.degraded = True
                return []
            saved = json.loads(raw)
            if not isinstance(saved, list):
                self.degraded = True
                return []
        except FileNotFoundError:
            return []
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            self.degraded = True
            return []
        items = []
        seen = set()
        for event in saved:
            try:
                record = self._normalize(event)
            except (TypeError, ValueError):
                self.degraded = True
                continue
            if record["id"] in seen:
                continue
            seen.add(record["id"])
            items.append(record)
        return self._fit(items, self.max_items, self.max_bytes)

    def _persist(self, items):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        payload = self._serialized(items)
        if len(payload) > self.max_bytes:
            raise ValueError("viewer history exceeds its storage limit")
        descriptor, temporary = tempfile.mkstemp(prefix=".viewer-history-", suffix=".tmp", dir=str(self.path.parent))
        try:
            os.chmod(temporary, 0o600)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        except Exception:
            try:
                os.close(descriptor)
            except OSError:
                pass
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise

    def append(self, event):
        record = self._normalize(event)
        with self._lock:
            if any(item["id"] == record["id"] for item in self._items):
                return False
            updated = self._fit(self._items + [record], self.max_items, self.max_bytes)
            if not updated or updated[-1]["id"] != record["id"]:
                return False
            self._persist(updated)
            self._items = updated
            return True

    def snapshot(self):
        with self._lock:
            return [dict(item) for item in self._fit(self._items, self.max_items, MAX_VIEWER_RESPONSE_BYTES)]
