#!/system/bin/sh

# Hearthroot Control persistent profile state.

MODDIR="/data/adb/modules/hearthroot.control"
DATA_DIR="/data/adb/hearthroot.control"

STATE="$DATA_DIR/last-profile"
ENABLED="$DATA_DIR/apply-on-boot"

umask 077

[ "$(id -u)" = "0" ] || {
    echo "Root permission required" >&2
    exit 1
}

valid_name() {
    case "$1" in
        ""|*[!a-zA-Z0-9_-]*) return 1 ;;
        *) return 0 ;;
    esac
}

save_profile() {
    mode="$1"
    cpu="${2:-}"
    io="${3:-}"
    xiaomi="${4:-none}"

    case "$mode" in
        native|balanced|battery|performance)
            record="$mode"
            ;;
        custom)
            valid_name "$cpu" || exit 2
            valid_name "$io" || exit 2
            case "$xiaomi" in
                none|normal|economy|boost) ;;
                *) echo "Invalid Xiaomi Parts selection" >&2; exit 2 ;;
            esac
            record="custom $cpu $io $xiaomi"
            ;;
        *)
            echo "Unsupported profile" >&2
            exit 2
            ;;
    esac

    mkdir -p "$DATA_DIR" || exit 1

    temp="$STATE.tmp.$$"

    if ! printf '%s\n' "$record" > "$temp"; then
        rm -f "$temp"
        exit 1
    fi

    if ! mv -f "$temp" "$STATE"; then
        rm -f "$temp"
        exit 1
    fi

    echo "Saved: $record"
}

restore_profile() {
    [ -f "$ENABLED" ] || exit 0
    [ -r "$STATE" ] || exit 0

    read -r mode cpu io xiaomi < "$STATE" || exit 1

    case "$mode" in
        native|balanced|battery|performance)
            /system/bin/sh "$MODDIR/scripts/apply-integrated.sh" "$mode"
            ;;
        custom)
            valid_name "$cpu" || exit 2
            valid_name "$io" || exit 2
            case "${xiaomi:-none}" in
                none|normal|economy|boost) ;;
                *) echo "Invalid saved Xiaomi profile" >&2; exit 2 ;;
            esac
            /system/bin/sh "$MODDIR/scripts/apply-integrated.sh" \
                custom "$cpu" "$io" "${xiaomi:-none}"
            ;;
        *)
            echo "Invalid saved profile" >&2
            exit 2
            ;;
    esac
}

case "${1:-}" in
    save)
        save_profile "${2:-}" "${3:-}" "${4:-}" "${5:-}"
        ;;

    enable)
        [ -s "$STATE" ] || {
            echo "Apply a profile before enabling boot restore" >&2
            exit 1
        }

        touch "$ENABLED" || exit 1
        echo "Apply on boot enabled"
        ;;

    disable)
        rm -f "$ENABLED" || exit 1
        echo "Apply on boot disabled"
        ;;

    status)
        if [ -f "$ENABLED" ]; then
            echo "BOOT=enabled"
        else
            echo "BOOT=disabled"
        fi

        if [ -r "$STATE" ]; then
            printf 'SAVED='
            cat "$STATE"
        else
            echo "SAVED=none"
        fi
        ;;

    boot)
        restore_profile
        ;;

    *)
        echo "Usage: boot-state.sh {save|enable|disable|status|boot}" >&2
        exit 2
        ;;
esac
