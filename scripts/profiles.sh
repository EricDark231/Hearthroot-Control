#!/system/bin/sh

# Hearthroot Control - CPU and I/O profiles
# Manual application only. No boot persistence.

CPU_BASE="/sys/devices/system/cpu/cpufreq"
IO_BASE="/sys/block"

error() {
    echo "ERROR: $*" >&2
    exit 1
}

current_scheduler() {
    sed -n 's/.*\[\([^]]*\)\].*/\1/p' "$1"
}

supports_io_profiles() {
    [ -f "$1" ] || return 1

    available="$(tr '[]' '  ' < "$1")"

    case " $available " in
        *" none "*) ;;
        *) return 1 ;;
    esac

    case " $available " in
        *" kyber "*) return 0 ;;
        *) return 1 ;;
    esac
}

show_status() {
    echo "=== CPU ==="
    found=0

    for policy in "$CPU_BASE"/policy*; do
        [ -f "$policy/scaling_governor" ] || continue
        found=1

        echo "${policy##*/}: $(cat "$policy/scaling_governor")"
    done

    [ "$found" -eq 1 ] || error "No CPU policies found"

    echo "=== I/O ==="

    for disk in "$IO_BASE"/sd*; do
        queue="$disk/queue/scheduler"
        supports_io_profiles "$queue" || continue

        echo "${disk##*/}: $(current_scheduler "$queue")"
    done
}

check_compatibility() {
    cpu_count=0
    io_count=0

    echo "=== CPU compatibility ==="

    for policy in "$CPU_BASE"/policy*; do
        [ -f "$policy/scaling_available_governors" ] || continue

        cpu_count=$((cpu_count + 1))
        available="$(cat "$policy/scaling_available_governors")"

        for governor in sugov_ext schedutil; do
            case " $available " in
                *" $governor "*) ;;
                *)
                    error "${policy##*/} lacks $governor"
                    ;;
            esac
        done

        echo "${policy##*/}: compatible"
    done

    [ "$cpu_count" -gt 0 ] || error "No CPU policies found"

    echo "=== I/O compatibility ==="

    for disk in "$IO_BASE"/sd*; do
        queue="$disk/queue/scheduler"
        [ -f "$queue" ] || continue

        if supports_io_profiles "$queue"; then
            io_count=$((io_count + 1))
            echo "${disk##*/}: none / kyber available"
        else
            echo "${disk##*/}: skipped (unsupported)"
        fi
    done

    [ "$io_count" -gt 0 ] ||
        error "No compatible UFS scheduler interfaces"

    echo "Profile compatibility: OK"
}

rollback() {
    echo "Restoring previous settings..." >&2
    restore_failed=0

    for record in $io_snapshot; do
        path="${record%:*}"
        value="${record##*:}"

        if ! printf '%s\n' "$value" > "$path"; then
            echo "Restore failed: $path" >&2
            restore_failed=1
        fi
    done

    for record in $cpu_snapshot; do
        path="${record%:*}"
        value="${record##*:}"

        if ! printf '%s\n' "$value" > "$path"; then
            echo "Restore failed: $path" >&2
            restore_failed=1
        fi
    done

    [ "$restore_failed" -eq 0 ] ||
        echo "WARNING: Some values could not be restored" >&2
}

apply_profile() {
    target_cpu="$1"
    target_io="$2"

    [ "$(id -u)" = "0" ] ||
        error "Root permission required"

    # Reject unsupported configurations before writing.
    check_compatibility >/dev/null || exit 1

    cpu_snapshot=""
    io_snapshot=""

    # Capture existing governors.
    for policy in "$CPU_BASE"/policy*; do
        path="$policy/scaling_governor"
        [ -f "$path" ] || continue

        current="$(cat "$path")" ||
            error "Cannot read $path"

        cpu_snapshot="$cpu_snapshot $path:$current"
    done

    # Capture existing I/O schedulers.
    for disk in "$IO_BASE"/sd*; do
        path="$disk/queue/scheduler"

        supports_io_profiles "$path" || continue

        current="$(current_scheduler "$path")"
        [ -n "$current" ] ||
            error "Cannot read scheduler for ${disk##*/}"

        io_snapshot="$io_snapshot $path:$current"
    done

    # Apply CPU governor.
    for record in $cpu_snapshot; do
        path="${record%:*}"

        if ! printf '%s\n' "$target_cpu" > "$path"; then
            rollback
            error "Failed to apply $target_cpu"
        fi

        if [ "$(cat "$path")" != "$target_cpu" ]; then
            rollback
            error "CPU governor verification failed"
        fi
    done

    # Apply I/O scheduler.
    for record in $io_snapshot; do
        path="${record%:*}"

        if ! printf '%s\n' "$target_io" > "$path"; then
            rollback
            error "Failed to apply $target_io"
        fi

        if [ "$(current_scheduler "$path")" != "$target_io" ]; then
            rollback
            error "I/O scheduler verification failed"
        fi
    done

    echo "Applied CPU: $target_cpu"
    echo "Applied I/O: $target_io"

    show_status
}

case "${1:-}" in
    status)
        show_status
        ;;
    check)
        check_compatibility
        ;;
    balanced)
        apply_profile "schedutil" "kyber"
        ;;
    native)
        apply_profile "sugov_ext" "none"
        ;;
    *)
        echo "Usage: profiles.sh {status|check|balanced|native}" >&2
        exit 2
        ;;
esac
