#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this update as root from the Debian console." >&2
    exit 1
fi

SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v sha256sum >/dev/null 2>&1; then
    echo "sha256sum is required to verify the read-only provisioning disc." >&2
    exit 1
fi
(cd "$SOURCE_DIR" && sha256sum -c SHA256SUMS)

if ! command -v systemctl >/dev/null 2>&1 || [ ! -x /usr/bin/python3 ]; then
    echo "The existing Debian Junction World runtime is unavailable." >&2
    exit 1
fi
if [ ! -f /etc/systemd/system/junction-world.service ]; then
    echo "The existing Junction World system service was not found." >&2
    exit 1
fi

browser_found=false
for browser in firefox-esr firefox chromium chromium-browser; do
    if command -v "$browser" >/dev/null 2>&1; then
        browser_found=true
        break
    fi
done
if [ "$browser_found" != true ]; then
    echo "No supported graphical browser is installed. Stop and choose a Debian-signed browser package before updating." >&2
    exit 1
fi

for file in world-service.py viewer_history.py viewer_http.py open-viewer.sh junction-world-viewer.desktop viewer/index.html viewer/viewer.css viewer/viewer.js; do
    if [ ! -f "$SOURCE_DIR/$file" ]; then
        echo "Required viewer update file is missing: $file" >&2
        exit 1
    fi
done

backup_dir=$(mktemp -d /var/backups/junction-world-viewer.XXXXXX)
chmod 0700 "$backup_dir"
targets="/usr/lib/junction-world/world-service.py
/usr/lib/junction-world/viewer_history.py
/usr/lib/junction-world/viewer_http.py
/usr/lib/junction-world/viewer/index.html
/usr/lib/junction-world/viewer/viewer.css
/usr/lib/junction-world/viewer/viewer.js
/usr/local/bin/junction-world-viewer
/usr/share/applications/junction-world-viewer.desktop"
while IFS= read -r target; do
    relative=${target#/}
    if [ -e "$target" ]; then
        install -d -m 0700 "$backup_dir/$(dirname "$relative")"
        cp -p "$target" "$backup_dir/$relative"
    fi
done <<EOF
$targets
EOF
rollback() {
    result=$?
    [ "$result" -eq 0 ] && return
    trap - EXIT
    echo "Viewer update failed; restoring the previous complete file set." >&2
    while IFS= read -r target; do
        relative=${target#/}
        if [ -e "$backup_dir/$relative" ]; then
            install -D -m "$(stat -c '%a' "$backup_dir/$relative")" -o root -g root "$backup_dir/$relative" "$target" || true
        else
            rm -f -- "$target"
        fi
    done <<EOF
$targets
EOF
    systemctl restart junction-world.service || true
    exit "$result"
}
trap rollback EXIT

install -d -m 0755 -o root -g root /usr/lib/junction-world /usr/lib/junction-world/viewer /usr/local/bin /usr/share/applications
install -m 0755 -o root -g root "$SOURCE_DIR/world-service.py" /usr/lib/junction-world/world-service.py
install -m 0644 -o root -g root "$SOURCE_DIR/viewer_history.py" /usr/lib/junction-world/viewer_history.py
install -m 0644 -o root -g root "$SOURCE_DIR/viewer_http.py" /usr/lib/junction-world/viewer_http.py
install -m 0644 -o root -g root "$SOURCE_DIR/viewer/index.html" /usr/lib/junction-world/viewer/index.html
install -m 0644 -o root -g root "$SOURCE_DIR/viewer/viewer.css" /usr/lib/junction-world/viewer/viewer.css
install -m 0644 -o root -g root "$SOURCE_DIR/viewer/viewer.js" /usr/lib/junction-world/viewer/viewer.js
install -m 0755 -o root -g root "$SOURCE_DIR/open-viewer.sh" /usr/local/bin/junction-world-viewer
install -m 0644 -o root -g root "$SOURCE_DIR/junction-world-viewer.desktop" /usr/share/applications/junction-world-viewer.desktop

if [ ! -e /var/lib/junction-world/viewer-history.json ]; then
    temporary_history=/var/lib/junction-world/viewer-history.json.$$.tmp
    printf '[]\n' > "$temporary_history"
    chmod 0600 "$temporary_history"
    chown root:root "$temporary_history"
    mv "$temporary_history" /var/lib/junction-world/viewer-history.json
fi

healthy=false
if systemctl restart junction-world.service; then
    attempt=0
    while [ "$attempt" -lt 20 ]; do
        if systemctl is-active --quiet junction-world.service && /usr/bin/python3 -c 'import json, urllib.request; r=urllib.request.urlopen("http://127.0.0.1:43131/v1/ui/snapshot", timeout=2); d=json.load(r); assert r.status == 200 and isinstance(d.get("events"), list) and isinstance(d.get("paused"), bool)' && systemctl is-active --quiet junction-world.service; then
            sleep 1
            if systemctl is-active --quiet junction-world.service; then
                healthy=true
                break
            fi
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
fi
if [ "$healthy" = true ]; then
    trap - EXIT
    echo "Junction World viewer files installed and its loopback snapshot is responding. Open Junction World from the Debian Applications menu."
    exit 0
fi

echo "Junction World did not restart successfully." >&2
exit 1
