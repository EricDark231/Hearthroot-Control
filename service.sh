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

mkdir -p "$DATA_DIR" || exit 0

LOG="$DATA_DIR/boot.log"
STATE="$DATA_DIR/last-profile"
XIAOMI="$MODDIR/scripts/xiaomi-sync.sh"

# Keep the previous log if the current one grows beyond 128 KiB.
if [ -f "$LOG" ]; then
    log_size="$(wc -c < "$LOG" 2>/dev/null)" || log_size=0
    case "$log_size" in
        ""|*[!0-9]*) log_size=0 ;;
    esac
    if [ "$log_size" -gt 131072 ]; then
        mv -f "$LOG" "$LOG.old" 2>/dev/null || :
    fi
fi

echo "=== Hearthroot boot restore ===" >> "$LOG"

# Determine whether the saved profile requests Xiaomi synchronization.
needs_xiaomi="no"
if [ -r "$STATE" ]; then
    read -r saved_mode saved_cpu saved_io saved_xiaomi < "$STATE" || :
    case "$saved_mode" in
        native|balanced|battery|performance)
            needs_xiaomi="yes"
            ;;
        custom)
            case "$saved_xiaomi" in
                normal|economy|boost) needs_xiaomi="yes" ;;
            esac
            ;;
    esac
fi

# Wait briefly for the authenticated Companion bridge.
# QUERY is read-only and never changes Xiaomi Parts settings.
if [ "$needs_xiaomi" = "yes" ] && [ -f "$XIAOMI" ]; then
    attempt=0
    companion_ready="no"

    while [ "$attempt" -lt 2 ]; do
        if [ -x /system/bin/timeout ]; then
            query_result="$(/system/bin/timeout 10 /system/bin/sh "$XIAOMI" QUERY 2>/dev/null)"
            query_rc=$?
        else
            query_result="$(/system/bin/sh "$XIAOMI" QUERY 2>/dev/null)"
            query_rc=$?
        fi

        if [ "$query_rc" -eq 0 ]; then
            case "$query_result" in
                XIAOMI_PROFILE=NORMAL|XIAOMI_PROFILE=ECONOMY|XIAOMI_PROFILE=BOOST|XIAOMI_PROFILE=EXTREME|XIAOMI_PROFILE=CUSTOM)
                    companion_ready="yes"
                    break
                    ;;
            esac
        fi

        attempt=$((attempt + 1))
        [ "$attempt" -ge 2 ] && break
        sleep 3
    done

    echo "BOOT_COMPANION_READY=$companion_ready" >> "$LOG"
fi

# Persistence may have been disabled while waiting.
[ -f "$ENABLED" ] || exit 0

if /system/bin/sh "$MODDIR/scripts/boot-state.sh" boot >> "$LOG" 2>&1; then
    echo "BOOT_RESTORE=OK" >> "$LOG"
else
    restore_rc=$?
    echo "BOOT_RESTORE=FAILED:$restore_rc" >> "$LOG"
fi

exit 0
