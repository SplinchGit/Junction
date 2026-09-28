#!/bin/sh
set -eu

URL='http://127.0.0.1:43131/ui'

for browser in firefox-esr firefox chromium chromium-browser; do
    if command -v "$browser" >/dev/null 2>&1; then
        exec "$browser" --new-window "$URL"
    fi
done

printf '%s\n' 'No supported graphical browser is installed. Install a Debian-signed Firefox ESR or Chromium package before opening Junction World.' >&2
exit 1
