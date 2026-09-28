"""Small persistence and recreation primitives for the long-lived Junction process."""
import json
import os
import pathlib
import random
import tempfile
import threading
import time
import uuid


TOOLS = {"create_goal", "update_goal", "abandon_goal", "complete_goal", "remember", "list_files", "read_file", "write_file", "delete_file", "write_diary", "schedule_wake", "sleep_for", "list_scheduled", "cancel_scheduled", "new_minesweeper", "reveal", "flag", "get_game", "research", "run_python", "restore_self"}


def bounded_text(value, size):
    return str(value).encode("utf8")[:size].decode("utf8", "ignore")


def build_model_messages(bootstrap, state, user_text, identity, addendum, tasks, game_status):
    """One authoritative context, one copy of each message, bounded before IPC."""
    history = state.get("chatHistory", [])
    # process_once persists the new owner message before calling inference.
    if history and history[-1].get("role") == "user" and history[-1].get("content") == user_text:
        history = history[:-1]
    records = [{"role": item["role"], "content": bounded_text(item["content"], 220), "source": item.get("source", "shared")}
               for item in history[-6:] if item.get("role") in {"user", "assistant"} and isinstance(item.get("content"), str)]
    sections = [bootstrap,
        "Runtime state (verified): " + json.dumps({"status": "WORKING", "unixTime": int(time.time()), "game": game_status}),
        "Persistent memory: " + bounded_text(state.get("memorySummary", ""), 1000),
        "Historical conversation records (past answers may be wrong): " + json.dumps(records, ensure_ascii=False),
        "Active goals: " + bounded_text(json.dumps(state.get("goals", []), ensure_ascii=False), 1200),
        "Scheduled wakes: " + bounded_text(json.dumps(tasks, ensure_ascii=False), 400),
        "Editable self-description: " + bounded_text(identity, 400),
        "Editable addendum: " + bounded_text(addendum, 400)]
    messages = [{"role": "system", "content": bounded_text("\n".join(sections)[:7800], 14000)}]
    messages.append({"role": "user", "content": bounded_text(user_text, 6000)})
    return bound_model_messages(messages)


def bound_model_messages(messages):
    """Pin system instructions and the current request while rolling tool evidence."""
    anchor = max(i for i, m in enumerate(messages) if m["role"] == "user" and not m["content"].startswith("Runtime-confirmed tool result:"))
    indexes = sorted({0, anchor, *range(max(1, len(messages) - 18), len(messages))})
    result = [dict(messages[i]) for i in indexes]
    while len(result) > 20 or len(json.dumps(result, ensure_ascii=False).encode("utf8")) > 28000:
        removable = next((i for i, original in enumerate(indexes) if original not in {0, anchor}), None)
        if removable is None:
            raise ValueError("system context and current request exceed inference budget")
        indexes.pop(removable)
        result.pop(removable)
    return result


def format_recent_conversation(history, limit=6):
    """Render a small, source-labeled continuity excerpt for the model context."""
    if not isinstance(history, list):
        return "(no recent shared conversation)"
    lines = []
    for item in history[-limit:]:
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
            continue
        if item["role"] == "assistant":
            speaker = "Junction"
        elif item.get("source") == "debian":
            speaker = "James via Debian local chat"
        elif item.get("source") == "android":
            speaker = "James via Android Audit"
        else:
            speaker = "James"
        content = " ".join(str(item.get("content", "")).split())[:320]
        if content:
            lines.append(speaker + ": " + content)
    return "\n".join(lines) if lines else "(no recent shared conversation)"


def format_incoming_message(history, content, source):
    """Put a tiny shared-history reference beside each new owner message."""
    excerpt = format_recent_conversation(history[-4:] if isinstance(history, list) else [])
    sender = "James via Debian local chat" if source == "debian" else "James via Android Audit"
    return ("Recent messages from your persistent shared conversation (same Junction across restarts):\n"
            + excerpt[:1500] + "\n\nNew message from " + sender + ":\n" + str(content)[:1800])[:3800]


def normalize_model_response(text):
    """Keep valid conversational output when a small model formats actions poorly."""
    original = text.strip()[:16000] if isinstance(text, str) else ""
    candidate = original
    if candidate.startswith("```"):
        candidate = candidate.strip("`").strip()
        if candidate.startswith("json"):
            candidate = candidate[4:].strip()
    try:
        start, end = candidate.find("{"), candidate.rfind("}")
        value = json.loads(candidate[start:end + 1]) if start >= 0 and end > start else None
    except (ValueError, TypeError):
        value = None
    if not isinstance(value, dict):
        return {"reflection": "", "reply": original[:2800] or "I couldn't interpret that model response. Please try again.", "actions": []}
    reflection = value.get("reflection", "")
    reply = value.get("reply", "")
    if not isinstance(reflection, str):
        reflection = ""
    if not isinstance(reply, str):
        reply = ""
    reflection = reflection[:1200]
    reply = reply[:2800]
    proposed = value.get("actions", [])
    actions = []
    if isinstance(proposed, list):
        for action in proposed:
            if not isinstance(action, dict) or set(action) != {"tool", "args"}:
                continue
            if not isinstance(action["tool"], str) or action["tool"] not in TOOLS or not isinstance(action["args"], dict):
                continue
            actions.append(action)
            if len(actions) == 5:
                break
    if not reply and not actions:
        reply = "I couldn't safely interpret that model response. I can still help if you rephrase."
    return {"reflection": reflection, "reply": reply, "actions": actions}


class Scheduler:
    MAX_TASKS = 128

    def __init__(self, path):
        self.path = pathlib.Path(path)
        self.lock = threading.RLock()
        self.tasks = []
        try:
            saved = json.loads(self.path.read_text(encoding="utf8"))
            if isinstance(saved, list):
                self.tasks = [item for item in saved if self._valid(item)][:self.MAX_TASKS]
        except (OSError, ValueError):
            pass

    @staticmethod
    def _valid(item):
        return (isinstance(item, dict) and isinstance(item.get("id"), str)
                and isinstance(item.get("label"), str) and len(item["label"]) <= 160
                and type(item.get("wakeAt")) in (int, float) and item["wakeAt"] > 0)

    def _save(self):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".scheduler-", suffix=".tmp", dir=str(self.path.parent))
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf8") as stream:
                json.dump(self.tasks, stream, ensure_ascii=False, separators=(",", ":"))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        except Exception:
            try:
                os.unlink(name)
            except OSError:
                pass
            raise

    def schedule(self, label, wake_at):
        if not isinstance(label, str) or not label.strip() or len(label) > 160:
            raise ValueError("invalid scheduled task label")
        if type(wake_at) not in (int, float) or wake_at < time.time() - 1 or wake_at > time.time() + 366 * 86400:
            raise ValueError("wake time must be within the next year")
        with self.lock:
            if len(self.tasks) >= self.MAX_TASKS:
                raise ValueError("scheduler is full")
            item = {"id": str(uuid.uuid4()), "label": label.strip(), "wakeAt": int(wake_at), "createdAt": int(time.time())}
            self.tasks.append(item)
            self._save()
            return dict(item)

    def sleep_for(self, label, seconds, now=None):
        if type(seconds) is not int or not 1 <= seconds <= 366 * 86400:
            raise ValueError("sleep duration must be 1 second to 1 year")
        return self.schedule(label, (time.time() if now is None else now) + seconds)

    def due_tasks(self, now=None):
        now = time.time() if now is None else now
        with self.lock:
            return [dict(item) for item in self.tasks if item["wakeAt"] <= now]

    def next_wake(self):
        with self.lock:
            return min((item["wakeAt"] for item in self.tasks), default=None)

    def cancel(self, task_id):
        with self.lock:
            before = len(self.tasks)
            self.tasks = [item for item in self.tasks if item["id"] != task_id]
            if len(self.tasks) == before:
                return False
            self._save()
            return True

    def complete(self, task_id):
        return self.cancel(task_id)

    def list_tasks(self):
        with self.lock:
            return [dict(item) for item in sorted(self.tasks, key=lambda item: item["wakeAt"])]


class Minesweeper:
    """Deterministic, machine-readable Minesweeper state and actions."""

    def __init__(self, width=9, height=9, mines=10, seed=None):
        if type(width) is not int or type(height) is not int or not 2 <= width <= 30 or not 2 <= height <= 30:
            raise ValueError("board size must be between 2 and 30")
        if type(mines) is not int or not 1 <= mines < width * height:
            raise ValueError("invalid mine count")
        self.width, self.height, self.mine_count = width, height, mines
        self._rng = random.Random(seed)
        positions = self._rng.sample(range(width * height), mines)
        self._board = [[0 for _ in range(width)] for _ in range(height)]
        for position in positions:
            self._board[position // width][position % width] = -1
        for y in range(height):
            for x in range(width):
                if self._board[y][x] != -1:
                    self._board[y][x] = sum(1 for nx, ny in self._neighbors(x, y) if self._board[ny][nx] == -1)
        self._revealed = set()
        self._flagged = set()
        self._status = "PLAYING"

    def _neighbors(self, x, y):
        return [(nx, ny) for ny in range(max(0, y - 1), min(self.height, y + 2))
                for nx in range(max(0, x - 1), min(self.width, x + 2)) if (nx, ny) != (x, y)]

    def _inside(self, x, y):
        return type(x) is int and type(y) is int and 0 <= x < self.width and 0 <= y < self.height

    def reveal(self, x, y):
        if not self._inside(x, y) or self._status != "PLAYING" or (x, y) in self._flagged or (x, y) in self._revealed:
            return {"accepted": False, "status": self._status}
        self._revealed.add((x, y))
        if self._board[y][x] == -1:
            self._status = "LOST"
        elif self._board[y][x] == 0:
            queue = [(x, y)]
            while queue:
                cx, cy = queue.pop()
                for neighbor in self._neighbors(cx, cy):
                    if neighbor not in self._revealed and neighbor not in self._flagged:
                        self._revealed.add(neighbor)
                        if self._board[neighbor[1]][neighbor[0]] == 0:
                            queue.append(neighbor)
        if self._status == "PLAYING" and len(self._revealed) == self.width * self.height - self.mine_count:
            self._status = "WON"
        return {"accepted": True, "status": self._status, "value": self._board[y][x]}

    def flag(self, x, y):
        if not self._inside(x, y) or self._status != "PLAYING" or (x, y) in self._revealed:
            return {"accepted": False, "status": self._status}
        if (x, y) in self._flagged:
            self._flagged.remove((x, y))
        else:
            self._flagged.add((x, y))
        return {"accepted": True, "status": self._status, "flagged": (x, y) in self._flagged}

    def get_status(self):
        return self._status

    def export(self):
        return {"width": self.width, "height": self.height, "mines": self.mine_count,
                "board": self._board, "revealed": [list(p) for p in sorted(self._revealed)],
                "flagged": [list(p) for p in sorted(self._flagged)], "status": self._status}

    @classmethod
    def restore(cls, value):
        if (not isinstance(value, dict) or type(value.get("width")) is not int
                or type(value.get("height")) is not int or type(value.get("mines")) is not int):
            raise ValueError("invalid saved game")
        game = cls(value["width"], value["height"], value["mines"], seed=0)
        board = value.get("board")
        if (not isinstance(board, list) or len(board) != game.height
                or any(not isinstance(row, list) or len(row) != game.width for row in board)
                or any(type(cell) is not int or cell < -1 or cell > 8 for row in board for cell in row)):
            raise ValueError("invalid saved board")
        game._board = board
        game._revealed = {tuple(p) for p in value.get("revealed", []) if isinstance(p, list) and len(p) == 2 and game._inside(*p)}
        game._flagged = {tuple(p) for p in value.get("flagged", []) if isinstance(p, list) and len(p) == 2 and game._inside(*p)}
        game._status = value.get("status") if value.get("status") in {"PLAYING", "WON", "LOST"} else "PLAYING"
        return game

    def get_board(self):
        return {"width": self.width, "height": self.height, "mines": self.mine_count, "status": self._status,
                "cells": [[{"x": x, "y": y, "revealed": (x, y) in self._revealed,
                            "flagged": (x, y) in self._flagged,
                            "value": self._board[y][x] if (x, y) in self._revealed or self._status in {"WON", "LOST"} else None,
                            "mine": self._board[y][x] == -1 if self._status in {"WON", "LOST"} else None}
                           for x in range(self.width)] for y in range(self.height)]}
