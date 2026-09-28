"""Portable read-only HTTP responses for the Junction World viewer."""
import datetime
import json
import pathlib
import uuid


MAX_ASSET_BYTES = 128 * 1024
MAX_RESPONSE_BYTES = 256 * 1024
STATIC_ROUTES = {
    "/ui": ("index.html", "text/html; charset=utf-8"),
    "/ui.css": ("viewer.css", "text/css; charset=utf-8"),
    "/ui.js": ("viewer.js", "text/javascript; charset=utf-8"),
}
COMMON_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
}
STATIC_HEADERS = {
    **COMMON_HEADERS,
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
}
VIEWER_ORIGIN = "http://127.0.0.1:43131"
CONVERSATION_ID = "550e8400-e29b-41d4-a716-446655440000"


def viewer_request_allowed(host, origin):
    """Reject DNS-rebinding and foreign-origin browser requests."""
    return host == "127.0.0.1:43131" and (origin is None or origin == VIEWER_ORIGIN)


def _response(status, content_type, data, headers=None):
    output_headers = dict(COMMON_HEADERS)
    if headers:
        output_headers.update(headers)
    output_headers["Content-Type"] = content_type
    output_headers["Content-Length"] = str(len(data))
    return status, output_headers, data


def _json_response(status, value):
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf8")
    if len(data) > MAX_RESPONSE_BYTES:
        data = b'{"error":"response too large"}'
        status = 503
    return _response(status, "application/json; charset=utf-8", data)


def local_message(value, paused):
    """Validate the local client message and normalize it to the shared inbox shape."""
    if paused:
        raise ValueError("Junction is paused")
    if not isinstance(value, dict) or set(value) != {"id", "content"}:
        raise ValueError("invalid message fields")
    try:
        if str(uuid.UUID(value["id"])) != value["id"].lower():
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ValueError("invalid message id")
    content = value["content"]
    if not isinstance(content, str) or not content.strip() or len(content) > 2800:
        raise ValueError("invalid message content")
    return {"id": value["id"], "conversationId": CONVERSATION_ID, "deviceId": "debian-local", "source": "debian", "content": content.strip()}


def viewer_response(method, path, history, control, asset_directory):
    """Return a fixed viewer response, or None for paths owned by other routes."""
    if method != "GET":
        return None
    if path in STATIC_ROUTES:
        filename, content_type = STATIC_ROUTES[path]
        asset_path = pathlib.Path(asset_directory) / filename
        try:
            with asset_path.open("rb") as stream:
                data = stream.read(MAX_ASSET_BYTES + 1)
        except OSError:
            return _json_response(404, {"error": "unavailable"})
        if len(data) > MAX_ASSET_BYTES:
            return _json_response(503, {"error": "viewer asset too large"})
        return _response(200, content_type, data, STATIC_HEADERS)
    if path != "/v1/ui/snapshot":
        return None
    if not isinstance(control, dict):
        return _json_response(503, {"error": "status unavailable"})
    paused = control.get("paused")
    heartbeat_minutes = control.get("heartbeatMinutes")
    history_degraded = control.get("historyDegraded", False)
    if type(paused) is not bool or type(heartbeat_minutes) is not int or not 10 <= heartbeat_minutes <= 120:
        return _json_response(503, {"error": "status unavailable"})
    if type(history_degraded) is not bool:
        return _json_response(503, {"error": "status unavailable"})
    events = history.snapshot()
    updated_at = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    status = control.get("status", "PAUSED" if paused else "IDLE")
    activity = control.get("activity", "Paused by James" if paused else "Waiting for a message or scheduled wake")
    model = control.get("model", "qwen3.5:2b")
    uptime = control.get("uptimeSeconds", 0)
    next_wake = control.get("nextWakeAt")
    started_at = control.get("startedAt")
    if status not in {"ACTIVE", "WORKING", "IDLE", "SLEEPING", "PAUSED", "ERROR", "STOPPED"} or not isinstance(activity, str) or len(activity) > 200 or not isinstance(model, str) or len(model) > 80 or type(uptime) is not int or uptime < 0:
        return _json_response(503, {"error": "status unavailable"})
    if next_wake is not None and type(next_wake) not in (int, float): return _json_response(503, {"error": "status unavailable"})
    return _json_response(200, {
        "paused": paused,
        "heartbeatMinutes": heartbeat_minutes,
        "historyDegraded": history_degraded,
        "status": "PAUSED" if paused else status,
        "activity": activity,
        "model": model,
        "uptimeSeconds": uptime,
        "nextWakeAt": next_wake,
        "startedAt": started_at,
        "updatedAt": updated_at,
        "events": events,
    })
