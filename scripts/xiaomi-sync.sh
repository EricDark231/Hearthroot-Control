#!/system/bin/sh
# Authenticated root -> Hearthroot Companion IPC. No direct sysfs writes.
[ "$(id -u)" = 0 ] || { echo "ERROR: root required" >&2; exit 1; }
URI="content://dev.hearthroot.companion.rootbridge"
COMMAND="${1:-QUERY}"
PROFILE="${2:-}"
case "$COMMAND" in
    QUERY) set -- --uri "$URI" --method QUERY ;;
    SET)
        case "$PROFILE" in NORMAL|ECONOMY|BOOST) ;;
            *) echo "ERROR: forbidden Xiaomi Parts profile" >&2; exit 2 ;; esac
        set -- --uri "$URI" --method SET --arg "$PROFILE"
        ;;
    *) echo "ERROR: expected QUERY or SET" >&2; exit 2 ;;
esac
[ -x /system/bin/content ] || { echo "ERROR: Android content tool unavailable" >&2; exit 1; }
raw="$(/system/bin/content call "$@" 2>&1)"
result=$?
if [ "$result" -ne 0 ]; then
    echo "XIAOMI_SYNC=UNAVAILABLE"
    echo "ERROR: Companion IPC failed: $raw" >&2
    exit 1
fi
case "$raw" in
    *status=OK*) ;;
    *) echo "XIAOMI_SYNC=UNAVAILABLE"; echo "ERROR: $raw" >&2; exit 1 ;;
esac
reported="$(printf '%s\n' "$raw" | sed -n 's/.*profile=\([A-Z]*\).*/\1/p' | head -n 1)"
case "$reported" in NORMAL|ECONOMY|BOOST|EXTREME|CUSTOM) ;;
    *) echo "ERROR: Invalid profile returned by Xiaomi Parts: $raw" >&2; exit 1 ;; esac
if [ "$COMMAND" = SET ] && [ "$PROFILE" != "$reported" ]; then
    echo "ERROR: Xiaomi Parts profile mismatch ($reported != $PROFILE)" >&2
    exit 1
fi
printf 'XIAOMI_PROFILE=%s\n' "$reported"
