#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this setup as root from the VirtualBox console." >&2
    exit 1
fi
if ! command -v nft >/dev/null 2>&1; then
    echo "Install Debian's official nftables package during the minimal OS setup, before applying offline egress rules." >&2
    exit 1
fi
if ! command -v systemd-run >/dev/null 2>&1 || ! command -v systemctl >/dev/null 2>&1; then
    echo "This runtime requires Debian's systemd service manager and systemd-run." >&2
    exit 1
fi
getent group junction >/dev/null 2>&1 || groupadd --system junction
if ! getent passwd junction >/dev/null 2>&1; then
    useradd --create-home --gid junction --shell /bin/bash junction
fi
getent group junction-code >/dev/null 2>&1 || groupadd --system junction-code
getent passwd junction-code >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin junction-code
usermod --append --groups junction-code junction
getent passwd junction-research >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin junction-research
if ! command -v python3 >/dev/null 2>&1; then
    echo "Install Debian's official python3 package before applying guest isolation." >&2
    exit 1
fi
install -d -m 0700 -o junction -g junction \
    /home/junction/junction \
    /home/junction/junction/identity \
    /home/junction/junction/memory \
    /home/junction/junction/goals \
    /home/junction/junction/projects \
    /home/junction/junction/journal \
    /home/junction/junction/diary \
    /home/junction/junction/self \
    /home/junction/junction/self/tools \
    /home/junction/junction/self/prompts \
    /home/junction/junction/self/.history \
    /home/junction/junction/logs \
    /home/junction/junction/state
chown junction:junction-code /home/junction /home/junction/junction
chmod 0710 /home/junction /home/junction/junction
chown junction:junction-code /home/junction/junction/projects
chmod 2770 /home/junction/junction/projects
chown -R junction:junction-code /home/junction/junction/self
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
install -d -m 0755 -o root -g root /home/junction/junction/projects/.junction-run
JUNCTION_RESEARCH_UID=$(id -u junction-research)
install -d -m 0700 -o root -g root /etc/junction-world /var/lib/junction-world
install -d -m 0750 -o root -g junction /run/junction-world
sed "s/@RESEARCH_UID@/${JUNCTION_RESEARCH_UID}/g" "$(dirname "$0")/junction-world.nft" > /etc/junction-world/firewall.nft
chown root:root /etc/junction-world/firewall.nft
chmod 0644 /etc/junction-world/firewall.nft
install -d -m 0755 -o root -g root /usr/lib/junction-world /usr/local/bin /usr/share/applications
install -m 0755 -o root -g root "$(dirname "$0")/world-service.py" /usr/lib/junction-world/world-service.py
install -m 0644 -o root -g root "$(dirname "$0")/viewer_history.py" /usr/lib/junction-world/viewer_history.py
install -m 0644 -o root -g root "$(dirname "$0")/viewer_http.py" /usr/lib/junction-world/viewer_http.py
install -m 0755 -o root -g root "$(dirname "$0")/research-broker.py" /usr/lib/junction-world/research-broker.py
install -m 0755 -o root -g root "$(dirname "$0")/agent.py" /usr/lib/junction-world/agent.py
install -m 0644 -o root -g root "$(dirname "$0")/persistent_runtime.py" /usr/lib/junction-world/persistent_runtime.py
install -d -m 0755 -o root -g root /usr/lib/junction-world/viewer
install -m 0644 -o root -g root "$(dirname "$0")/viewer/index.html" /usr/lib/junction-world/viewer/index.html
install -m 0644 -o root -g root "$(dirname "$0")/viewer/viewer.css" /usr/lib/junction-world/viewer/viewer.css
install -m 0644 -o root -g root "$(dirname "$0")/viewer/viewer.js" /usr/lib/junction-world/viewer/viewer.js
install -m 0755 -o root -g root "$(dirname "$0")/open-viewer.sh" /usr/local/bin/junction-world-viewer
install -m 0755 -o root -g root "$(dirname "$0")/junction-cli.py" /usr/local/bin/junction
install -m 0755 -o root -g root "$(dirname "$0")/native-chat.py" /usr/lib/junction-world/native-chat.py
install -m 0755 -o root -g root "$(dirname "$0")/open-native-chat.sh" /usr/local/bin/junction-chat
install -m 0644 -o root -g root "$(dirname "$0")/junction-chat.desktop" /usr/share/applications/junction-chat.desktop
install -m 0644 -o root -g root "$(dirname "$0")/junction-world-viewer.desktop" /usr/share/applications/junction-world-viewer.desktop
install -m 0644 -o root -g root "$(dirname "$0")/junction-world.service" /etc/systemd/system/junction-world.service
install -m 0644 -o root -g root "$(dirname "$0")/junction-world-heartbeat.service" /etc/systemd/system/junction-world-heartbeat.service
install -m 0644 -o root -g root "$(dirname "$0")/junction-world-tmpfiles.conf" /etc/tmpfiles.d/junction-world.conf
install -d -m 0755 -o root -g root /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/junction-world.conf <<'EOF'
[Journal]
SystemMaxUse=32M
RuntimeMaxUse=16M
EOF
cat > /etc/nftables.conf <<'EOF'
include "/etc/junction-world/firewall.nft"
EOF
chmod 0644 /etc/nftables.conf
systemctl daemon-reload
systemd-tmpfiles --create /etc/tmpfiles.d/junction-world.conf
systemctl restart systemd-journald.service
systemctl enable nftables.service junction-world.service
systemctl restart nftables.service
nft list ruleset
printf '\nJunction World services and deny-by-default firewall are installed. The agent remains host-paused.\n'
