#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this inspection/resize as root from the VirtualBox console." >&2
    exit 1
fi
if ! command -v growpart >/dev/null 2>&1; then
    echo "Install Debian's official cloud-guest-utils package first." >&2
    exit 1
fi
ROOT_SOURCE=$(findmnt -nro SOURCE /)
ROOT_DEVICE=$(readlink -f "$ROOT_SOURCE")
ROOT_TYPE=$(findmnt -nro FSTYPE /)
PARENT=$(lsblk -nro PKNAME "$ROOT_DEVICE" 2>/dev/null || true)
PARTITION=$(lsblk -nro PARTN "$ROOT_DEVICE" 2>/dev/null || true)
if [ -z "$PARENT" ] || [ -z "$PARTITION" ]; then
    echo "Root is not a directly expandable disk partition ($ROOT_SOURCE). No changes made; inspect LVM/RAID/encryption layout manually." >&2
    exit 1
fi
DISK="/dev/$PARENT"
LAST_PARTITION=$(lsblk -nrpo NAME,TYPE "$DISK" | awk '$2 == "part" { last = $1 } END { print last }')
if [ "$LAST_PARTITION" != "$ROOT_DEVICE" ]; then
    echo "The root partition is not the final partition ($ROOT_DEVICE; last is $LAST_PARTITION). No changes made; inspect the intervening swap/data partition before resizing." >&2
    exit 1
fi
case "$ROOT_TYPE" in
    ext4|ext3|ext2) RESIZE_TOOL=resize2fs ;;
    xfs) RESIZE_TOOL=xfs_growfs ;;
    *) echo "Unsupported root filesystem $ROOT_TYPE. No changes made." >&2; exit 1 ;;
esac
echo "About to extend final root partition $ROOT_DEVICE on $DISK. Existing filesystem data will be preserved."
growpart "$DISK" "$PARTITION"
if [ "$ROOT_TYPE" = xfs ]; then
    xfs_growfs /
else
    "$RESIZE_TOOL" "$ROOT_DEVICE"
fi
AVAILABLE=$(df -B1 --output=avail / | tail -n 1 | tr -d ' ')
printf 'Root filesystem available bytes: %s\n' "$AVAILABLE"
if [ "$AVAILABLE" -lt 10000000000 ]; then
    echo "The guest has less than 10 GB usable space. Keep Junction paused and inspect the disk layout/capacity." >&2
    exit 2
fi
echo "At least 10 GB of guest filesystem space is available."
