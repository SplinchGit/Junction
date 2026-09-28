#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this update as root from the Debian console." >&2
    exit 1
fi
SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
(cd "$SOURCE_DIR" && sha256sum -c SHA256SUMS)
if ! command -v systemctl >/dev/null 2>&1 || [ ! -x /usr/bin/python3 ]; then
    echo "The Debian Junction World runtime is unavailable." >&2
    exit 1
fi
if [ ! -f /etc/systemd/system/junction-world.service ]; then
    echo "The existing Junction World supervisor was not found." >&2
    exit 1
fi

FILES="agent.py
persistent_runtime.py
world-service.py
viewer_history.py
viewer_http.py
research-broker.py
open-viewer.sh
junction-cli.py
native-chat.py
open-native-chat.sh
junction-chat.desktop
junction-world-viewer.desktop
junction-world.service
junction-world-heartbeat.service
junction-world-tmpfiles.conf
viewer/index.html
viewer/viewer.css
viewer/viewer.js"
for file in $FILES; do
    if [ ! -f "$SOURCE_DIR/$file" ]; then
        echo "Required runtime update file is missing: $file" >&2
        exit 1
    fi
done

backup_dir=$(mktemp -d /var/backups/junction-world-runtime.XXXXXX)
chmod 0700 "$backup_dir"
TARGETS="/usr/lib/junction-world/agent.py
/usr/lib/junction-world/persistent_runtime.py
/usr/lib/junction-world/world-service.py
/usr/lib/junction-world/viewer_history.py
/usr/lib/junction-world/viewer_http.py
/usr/lib/junction-world/research-broker.py
/usr/lib/junction-world/viewer/index.html
/usr/lib/junction-world/viewer/viewer.css
/usr/lib/junction-world/viewer/viewer.js
/usr/local/bin/junction-world-viewer
/usr/local/bin/junction
/usr/local/bin/junction-chat
/usr/lib/junction-world/native-chat.py
/usr/share/applications/junction-chat.desktop
/usr/share/applications/junction-world-viewer.desktop
/etc/systemd/system/junction-world.service
/etc/systemd/system/junction-world-heartbeat.service
/etc/tmpfiles.d/junction-world.conf"
while IFS= read -r target; do
    relative=${target#/}
    if [ -e "$target" ]; then
        install -d -m 0700 "$backup_dir/$(dirname "$relative")"
        cp -p "$target" "$backup_dir/$relative"
    fi
done <<EOF
$TARGETS
EOF

rollback() {
    result=$?
    [ "$result" -eq 0 ] && return
    trap - EXIT
    echo "Runtime update failed; restoring the previous protected files." >&2
    systemctl stop junction-world-heartbeat.service >/dev/null 2>&1 || true
    while IFS= read -r target; do
        relative=${target#/}
        if [ -e "$backup_dir/$relative" ]; then
            install -D -m "$(stat -c '%a' "$backup_dir/$relative")" -o root -g root "$backup_dir/$relative" "$target" || true
        else
            rm -f -- "$target"
        fi
    done <<EOF
$TARGETS
EOF
    systemctl daemon-reload || true
    systemd-tmpfiles --create /etc/tmpfiles.d/junction-world.conf || true
    systemctl restart junction-world.service || true
    exit "$result"
}
trap rollback EXIT

systemctl stop junction-world-heartbeat.service
install -d -m 0755 -o root -g root /usr/lib/junction-world /usr/lib/junction-world/viewer /usr/local/bin /usr/share/applications /etc/tmpfiles.d
for file in agent.py persistent_runtime.py world-service.py research-broker.py; do
    install -m 0755 -o root -g root "$SOURCE_DIR/$file" "/usr/lib/junction-world/$file"
done
for file in viewer_history.py viewer_http.py; do
    install -m 0644 -o root -g root "$SOURCE_DIR/$file" "/usr/lib/junction-world/$file"
done
for file in viewer/index.html viewer/viewer.css viewer/viewer.js; do
    install -m 0644 -o root -g root "$SOURCE_DIR/$file" "/usr/lib/junction-world/$file"
done
install -m 0755 -o root -g root "$SOURCE_DIR/open-viewer.sh" /usr/local/bin/junction-world-viewer
install -m 0755 -o root -g root "$SOURCE_DIR/junction-cli.py" /usr/local/bin/junction
install -m 0755 -o root -g root "$SOURCE_DIR/native-chat.py" /usr/lib/junction-world/native-chat.py
install -m 0755 -o root -g root "$SOURCE_DIR/open-native-chat.sh" /usr/local/bin/junction-chat
install -m 0644 -o root -g root "$SOURCE_DIR/junction-chat.desktop" /usr/share/applications/junction-chat.desktop
install -m 0644 -o root -g root "$SOURCE_DIR/junction-world-viewer.desktop" /usr/share/applications/junction-world-viewer.desktop
install -m 0644 -o root -g root "$SOURCE_DIR/junction-world.service" /etc/systemd/system/junction-world.service
install -m 0644 -o root -g root "$SOURCE_DIR/junction-world-heartbeat.service" /etc/systemd/system/junction-world-heartbeat.service
install -m 0644 -o root -g root "$SOURCE_DIR/junction-world-tmpfiles.conf" /etc/tmpfiles.d/junction-world.conf

install -d -m 0700 -o junction -g junction /home/junction/junction/state /home/junction/junction/memory /home/junction/junction/diary /home/junction/junction/self /home/junction/junction/self/tools /home/junction/junction/self/prompts /home/junction/junction/self/.history
chown -R junction:junction-code /home/junction/junction/self
chown junction:junction-code /home/junction/junction/self
chmod 2770 /home/junction/junction/self /home/junction/junction/self/tools /home/junction/junction/self/prompts
chmod 0700 /home/junction/junction/self/.history
if [ ! -e /home/junction/junction/self/identity.md ]; then
    cat > /home/junction/junction/self/identity.md <<'EOF'
# Junction self-description

I am Junction, running in the persistent Debian VM workspace. The model is a host-brokered inference service. My workspace, shared conversation, diary, projects and scheduler persist across runtime restarts and VM reboots. The Junction-owned `self/` area is editable; `/usr/lib/junction-world`, systemd policy, networking and host broker are supervisor-controlled.
EOF
    chown junction:junction-code /home/junction/junction/self/identity.md
    chmod 0660 /home/junction/junction/self/identity.md
fi
if [ ! -e /var/lib/junction-world/viewer-history.json ]; then
    printf '[]\n' > /var/lib/junction-world/viewer-history.json
    chmod 0600 /var/lib/junction-world/viewer-history.json
fi

systemctl daemon-reload
systemd-tmpfiles --create /etc/tmpfiles.d/junction-world.conf
systemctl restart junction-world.service
healthy=false
attempt=0
while [ "$attempt" -lt 30 ]; do
    if systemctl is-active --quiet junction-world.service && systemctl is-active --quiet junction-world-heartbeat.service && /usr/bin/python3 -c 'import json, urllib.request; r=urllib.request.urlopen("http://127.0.0.1:43131/v1/ui/snapshot", timeout=2); d=json.load(r); assert r.status == 200 and isinstance(d.get("events"), list) and isinstance(d.get("paused"), bool) and "status" in d' && systemctl is-active --quiet junction-world.service; then
        healthy=true
        break
    fi
    attempt=$((attempt + 1))
    sleep 1
done
if [ "$healthy" != true ]; then
    echo "The Junction runtime did not become healthy." >&2
    exit 1
fi
trap - EXIT
rm -rf -- "$backup_dir"
echo "Persistent Junction runtime installed. Supervisor and persistent agent are active; host control still determines whether Junction is paused. Run junction chat from a Debian terminal."
