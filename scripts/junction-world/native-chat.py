#!/usr/bin/python3
"""Native GTK client of the existing local Junction service; no cognition here."""
import json
import threading
import urllib.error
import urllib.request
import uuid

BASE = "http://127.0.0.1:43131"
MAX_RESPONSE = 256 * 1024


def request(path, value=None):
    if path not in {"/v1/ui/snapshot", "/v1/ui/messages", "/v1/ui/diary"}:
        raise ValueError("Unknown local client route")
    data = json.dumps(value).encode("utf8") if value is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers={"Accept": "application/json", "Content-Type": "application/json"})
    # Never send local chat through an environment-configured proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=5) as response:
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise ValueError("Local service response exceeds the display limit")
    return json.loads(raw)


def display_snapshot(snapshot):
    conversations, activity = [], []
    for event in snapshot.get("events", []):
        stamp = event.get("occurredAt", "")
        if event.get("category") == "COMMUNICATION":
            who = "Junction" if event.get("communicationDirection") == "AGENT_TO_OWNER" else "James · " + ("Debian" if event.get("source") == "debian" else "Android")
            conversations.append(who + "  ·  " + stamp + "\n" + event.get("message", "") + "\n")
        else:
            category = event.get("category", "Activity")
            if category == "REFLECTION":
                category = "Model summary (unverified)"
            activity.append(stamp + "  " + category + "\n" + event.get("summary", "") + "\n")
    status = "Junction — " + snapshot.get("status", "UNKNOWN")
    detail = snapshot.get("activity", "") + "\nModel: " + snapshot.get("model", "unknown")
    detail += " · Runtime uptime: " + str(snapshot.get("uptimeSeconds", 0)) + "s"
    if snapshot.get("nextWakeAt"):
        from datetime import datetime
        detail += " · Next wake: " + datetime.fromtimestamp(snapshot["nextWakeAt"]).astimezone().isoformat(timespec="minutes")
    return status, detail, "\n".join(conversations), "\n".join(activity)


def main():
    import gi
    gi.require_version("Gtk", "3.0")
    from gi.repository import Gtk, GLib

    class JunctionWindow(Gtk.ApplicationWindow):
        def __init__(self, app):
            super().__init__(application=app, title="Junction")
            self.set_default_size(820, 640)
            self.polling = False
            self.sending = False
            self.closed = False
            self.pending = None
            self.paused = True
            self.connect("destroy", self.close_client)
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, margin=14)
            self.add(box)
            self.status = Gtk.Label(label="Connecting to Junction…", xalign=0)
            self.detail = Gtk.Label(label="Shared with Android Audit", xalign=0)
            self.detail.set_line_wrap(True)
            box.pack_start(self.status, False, False, 0)
            box.pack_start(self.detail, False, False, 0)
            notebook = Gtk.Notebook()
            box.pack_start(notebook, True, True, 0)
            self.views = []
            for name in ("Conversation", "Activity", "Diary"):
                view = Gtk.TextView(editable=False, cursor_visible=False, wrap_mode=Gtk.WrapMode.WORD_CHAR)
                view.set_left_margin(12)
                view.set_right_margin(12)
                pane = Gtk.ScrolledWindow()
                pane.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
                pane.add(view)
                notebook.append_page(pane, Gtk.Label(label=name))
                self.views.append((view, pane))
            notebook.connect("switch-page", self.switch_page)
            row = Gtk.Box(spacing=8)
            self.entry = Gtk.Entry()
            self.entry.set_placeholder_text("Talk to Junction…")
            self.entry.set_max_length(2000)
            self.entry.connect("activate", self.send)
            row.pack_start(self.entry, True, True, 0)
            self.send_button = Gtk.Button(label="Send")
            self.send_button.set_sensitive(False)
            self.send_button.connect("clicked", self.send)
            row.pack_start(self.send_button, False, False, 0)
            box.pack_start(row, False, False, 0)
            self.notice = Gtk.Label(label="Closing this window leaves Junction running. Owner pause is controlled through Audit.", xalign=0)
            self.notice.set_line_wrap(True)
            box.pack_start(self.notice, False, False, 0)
            self.show_all()
            self.timer = GLib.timeout_add_seconds(2, self.poll)
            self.poll()

        def close_client(self, *_args):
            self.closed = True
            GLib.source_remove(self.timer)

        def background(self, work, finish):
            def worker():
                try:
                    value, error = work(), None
                except Exception as exc:
                    value, error = None, str(exc)[:200]
                def deliver():
                    if not self.closed:
                        finish(value, error)
                    return False
                GLib.idle_add(deliver)
            threading.Thread(target=worker, daemon=True).start()

        def set_view(self, index, text):
            view, pane = self.views[index]
            buf = view.get_buffer()
            if buf.get_text(buf.get_start_iter(), buf.get_end_iter(), True) == text:
                return
            adjustment = pane.get_vadjustment()
            at_bottom = adjustment.get_value() + adjustment.get_page_size() >= adjustment.get_upper() - 30
            old_position = adjustment.get_value()
            buf.set_text(text)  # Render plain text; model output is never markup/code.
            def restore_scroll():
                if not self.closed:
                    adjustment.set_value(max(0, adjustment.get_upper() - adjustment.get_page_size()) if at_bottom else old_position)
                return False
            GLib.idle_add(restore_scroll)

        def poll(self):
            if self.closed:
                return False
            if not self.polling:
                self.polling = True
                self.background(lambda: request("/v1/ui/snapshot"), self.refresh)
            return True

        def refresh(self, snapshot, error):
            self.polling = False
            if error:
                self.status.set_text("Junction — reconnecting")
                self.detail.set_text("The local service is unavailable. Reconnecting automatically.")
                self.send_button.set_sensitive(False)
                self.paused = True
                return
            self.paused = bool(snapshot.get("paused", True))
            status, detail, conversation, activity = display_snapshot(snapshot)
            self.status.set_text(status)
            self.detail.set_text(detail)
            self.set_view(0, conversation)
            self.set_view(1, activity)
            self.send_button.set_sensitive(not self.paused and not self.sending)

        def send(self, *_args):
            text = self.entry.get_text().strip()
            if not text or self.sending or self.paused:
                return
            if not self.pending or self.pending["content"] != text:
                self.pending = {"id": str(uuid.uuid4()), "content": text}
            message = dict(self.pending)
            self.sending = True
            self.entry.set_sensitive(False)
            self.send_button.set_sensitive(False)
            def finished(value, error):
                self.sending = False
                self.entry.set_sensitive(True)
                self.send_button.set_sensitive(not self.paused)
                if error or not value.get("accepted"):
                    self.notice.set_text("Message delivery could not be confirmed. Retry uses the same message ID to avoid duplicates.")
                else:
                    self.pending = None
                    self.entry.set_text("")
                    self.notice.set_text("Message delivered to the shared Junction runtime. Its reply will appear here and in Audit.")
                    self.poll()
                self.entry.grab_focus()
            self.background(lambda: request("/v1/ui/messages", message), finished)

        def switch_page(self, _notebook, _page, index):
            if index == 2:
                self.background(lambda: request("/v1/ui/diary"), lambda value, error: self.set_view(2, "Diary unavailable; reopen this tab to retry." if error else value.get("content") or "Junction has not written a diary entry yet."))

    app = Gtk.Application(application_id="org.junction.WorldChat")
    def activate(application):
        window = application.get_active_window()
        if window is None:
            window = JunctionWindow(application)
        window.present()
    app.connect("activate", activate)
    return app.run(None)


if __name__ == "__main__":
    raise SystemExit(main())
