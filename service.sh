#!/system/bin/sh

# Hearthroot Control
# Optional profile restoration after Android boot.

MODDIR="${0%/*}"
DATA_DIR="/data/adb/hearthroot.control"
ENABLED="$DATA_DIR/apply-on-boot"

# Never change kernel settings without explicit opt-in.
[ -f "$ENABLED" ] || exit 0

# Wait for Android to finish booting.
count=0

while [ "$(getprop sys.boot_completed)" != "1" ]; do
    count=$((count + 1))

    # Stop waiting after approximately 180 seconds.
    [ "$count" -ge 90 ] && exit 0

    sleep 2
done

# Allow system services to finish initial configuration.
sleep 20

# The user may have disabled persistence meanwhile.
[ -f "$ENABLED" ] || exit 0

mkdir -p "$DATA_DIR"

echo "=== Hearthroot boot restore ===" \
    >> "$DATA_DIR/boot.log"

/system/bin/sh \
    "$MODDIR/scripts/boot-state.sh" boot \
    >> "$DATA_DIR/boot.log" 2>&1

exit 0
