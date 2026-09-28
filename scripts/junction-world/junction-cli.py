#!/usr/bin/python3
"""Local terminal client for the one shared Junction World runtime."""
import datetime
import json
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = "http://127.0.0.1:43131"
CONVERSATION_ID = "550e8400-e29b-41d4-a716-446655440000"


def request(path, method="GET", value=None):
    data = None if value is None else json.dumps(value).encode("utf8")
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, headers=headers, method=method), timeout=5) as response:
            return json.loads(response.read(256 * 1024).decode("utf8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        raise RuntimeError("Junction World local service is unavailable: " + str(error))


def status():
    value = request("/v1/ui/snapshot")
    print("Junction — " + value["status"])
    print("Activity: " + value["activity"])
    print("Model: " + value["model"])
    print("Uptime: " + str(value["uptimeSeconds"]) + " seconds")
    if value.get("nextWakeAt"):
        print("Next wake: " + datetime.datetime.fromtimestamp(value["nextWakeAt"]).astimezone().isoformat(timespec="minutes"))


def diary():
    value = request("/v1/ui/diary")
    print(value.get("content") or "Junction's diary is empty.")


def chat():
    print("Junction — local client (shared with Android Audit). Type /quit to leave this terminal.")
    snapshot = request("/v1/ui/snapshot")
    print("Status: " + snapshot["status"] + " · " + snapshot["activity"])
    for event in snapshot["events"][-20:]:
        if event["category"] != "COMMUNICATION":
            continue
        who = "Junction" if event["communicationDirection"] == "AGENT_TO_OWNER" else ("James · Debian" if event.get("source") == "debian" else "James · Android")
        print(who + ": " + event["message"])
    while True:
        try:
            text = input("James> ").strip()
            if text == "/quit":
                return
            if not text:
                continue
            message_id = str(uuid.uuid4())
            expected = str(uuid.uuid5(uuid.NAMESPACE_URL, message_id + ":reply"))
            response = request("/v1/ui/messages", "POST", {"id": message_id, "content": text})
            if not response.get("accepted"):
                print("Junction did not accept the message.")
                continue
            print("Junction is working…")
            while True:
                time.sleep(2)
                snapshot = request("/v1/ui/snapshot")
                reply = next((item for item in snapshot["events"] if item["category"] == "COMMUNICATION" and item["id"] == expected), None)
                if reply:
                    print("Junction> " + reply["message"])
                    break
                print("\rJunction — " + snapshot["status"] + ": " + snapshot["activity"][:72] + "   ", end="", flush=True)
        except (EOFError, KeyboardInterrupt):
            print("\nLocal chat closed; Junction keeps running.")
            return
        except RuntimeError as error:
            print("\n" + str(error))
            return


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "chat"
    try:
        if command == "chat": chat()
        elif command == "status": status()
        elif command == "diary": diary()
        elif command == "viewer":
            import subprocess
            subprocess.Popen(["/usr/local/bin/junction-world-viewer"], close_fds=True)
        elif command == "app":
            import subprocess
            subprocess.Popen(["/usr/local/bin/junction-chat"], close_fds=True)
        else:
            print("Usage: junction [app|chat|status|diary|viewer]", file=sys.stderr)
            return 2
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
