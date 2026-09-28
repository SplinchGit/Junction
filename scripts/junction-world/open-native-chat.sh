#!/bin/sh
set -eu
if /usr/bin/python3 -c 'import gi; gi.require_version("Gtk", "3.0"); from gi.repository import Gtk' >/dev/null 2>&1; then
    exec /usr/bin/python3 -I -B /usr/lib/junction-world/native-chat.py
fi
# A native terminal client remains usable without installing GUI dependencies.
exec x-terminal-emulator -T 'Junction — chat' -e /usr/local/bin/junction chat
