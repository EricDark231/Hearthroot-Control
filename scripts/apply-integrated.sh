#!/system/bin/sh
# Single entrypoint: preserve ordered kernel governor + Xiaomi Parts transitions.
# Normal/Boost wake CPU clusters BEFORE applying governors; Economy applies AFTER.
MODDIR="/data/adb/modules/hearthroot.control"
PROFILES="$MODDIR/scripts/profiles.sh"
XIAOMI="$MODDIR/scripts/xiaomi-sync.sh"
mode="${1:-}"
xmode="none"
case "$mode" in
 recovery)
    cpu="${2:-keep}"
    io="${3:-keep}"

    case "$cpu" in
      keep) ;;
      ""|*[!a-zA-Z0-9_-]*)
        echo "Invalid recovery CPU governor" >&2
        exit 2
        ;;
      *) ;;
    esac

    case "$io" in
      keep) ;;
      ""|*[!a-zA-Z0-9_-]*)
        echo "Invalid recovery I/O scheduler" >&2
        exit 2
        ;;
      *) ;;
    esac

    [ "$cpu" != "keep" ] || [ "$io" != "keep" ] || {
      echo "Recovery requested no changes" >&2
      exit 2
    }

    set -- recovery "$cpu" "$io"
    ;;
 io-only)
    io="${2:-}"
    case "$io" in
      none|kyber|mq-deadline|bfq|adios) ;;
      *) echo "Invalid I/O scheduler" >&2; exit 2 ;;
    esac
    set -- io-only "$io"
    ;;
 native|balanced) xmode="NORMAL"; set -- "$mode" ;;
 battery) xmode="ECONOMY"; set -- "$mode" ;;
 performance) xmode="BOOST"; set -- "$mode" ;;
 custom)
    cpu="${2:-}"; io="${3:-}"; choice="${4:-none}"
    case "$cpu" in ""|*[!a-zA-Z0-9_-]*) echo "Invalid CPU option" >&2; exit 2 ;; esac
    case "$io" in ""|*[!a-zA-Z0-9_-]*) echo "Invalid I/O option" >&2; exit 2 ;; esac
    case "$choice" in
      none) xmode="none";;
      normal) xmode="NORMAL";;
      economy) xmode="ECONOMY";;
      boost) xmode="BOOST";;
      *) echo "Invalid Xiaomi Parts option" >&2; exit 2;; esac
    set -- custom "$cpu" "$io"
    ;;
 *) echo "Usage: apply-integrated.sh {native|balanced|battery|performance|custom cpu io [none|normal|economy|boost]|recovery [cpu|keep] [io|keep]}" >&2; exit 2;;
esac
[ "$(id -u)" = 0 ] || { echo "Root required" >&2; exit 1; }
# XIAOMI_BRIDGE_GUARD_V1
# A live QUERY is the reliable check for LSPosed hook + Companion availability.
# The manager APK being installed is NOT proof that the hook is loaded.
# Never perform SET or start Xiaomi Parts if the query fails.
status="SKIPPED:NO_SYNC_REQUESTED"
xiaomi_ready="no"
original_xiaomi=""

# Detect an intentionally offline CPU policy.
# Never classify unknown CPU state as offline.
integrated_policy_is_offline() {
  _ip_policy="$1"
  _ip_related="$(cat "$_ip_policy/related_cpus" 2>/dev/null)" || return 1
  [ -n "$_ip_related" ] || return 1

  for _ip_cpu in $_ip_related; do
    case "$_ip_cpu" in
      ""|*[!0-9]*) return 1 ;;
    esac

    _ip_online="/sys/devices/system/cpu/cpu${_ip_cpu}/online"
    [ -f "$_ip_online" ] || return 1
    [ "$(cat "$_ip_online" 2>/dev/null)" = "0" ] || return 1
  done

  return 0
}

# Snapshot of kernel settings before applying a new profile.
cpu_snapshot=""
io_snapshot=""
snapshot_complete="yes"

capture_kernel_state() {
  cpu_snapshot=""
  io_snapshot=""
  snapshot_complete="yes"

  for name in policy0 policy4 policy7; do
    path="/sys/devices/system/cpu/cpufreq/$name/scaling_governor"
    value="$(cat "$path" 2>/dev/null)" || value=""
    if [ -n "$value" ]; then
      cpu_snapshot="$cpu_snapshot $path:$value"
    elif integrated_policy_is_offline "/sys/devices/system/cpu/cpufreq/$name"; then
      echo "INFO: Snapshot skipped for offline CPU policy $name" >&2
      snapshot_complete="no"
    else
      echo "WARNING: Cannot snapshot CPU policy $name" >&2
      snapshot_complete="no"
    fi
  done

  for disk in /sys/block/sd*; do
    path="$disk/queue/scheduler"
    [ -f "$path" ] || continue

    available="$(tr '[]' '  ' < "$path" 2>/dev/null)" || continue
    case " $available " in *" none "*) ;; *) continue ;; esac
    case " $available " in *" kyber "*) ;; *) continue ;; esac

    value="$(sed -n 's/.*\[\([^]]*\)\].*/\1/p' "$path")"
    if [ -n "$value" ]; then
      io_snapshot="$io_snapshot $path:$value"
    else
      snapshot_complete="no"
    fi
  done
}

restore_io_state() {
  io_restore_failed="no"

  for record in $io_snapshot; do
    path="${record%:*}"
    value="${record##*:}"

    if ! printf '%s\\n' "$value" > "$path" 2>/dev/null ||
       [ "$(sed -n 's/.*\\[\\([^]]*\\)\\].*/\\1/p' "$path")" != "$value" ]; then
      echo "WARNING: Could not restore I/O: $path" >&2
      io_restore_failed="yes"
    fi
  done

  [ "$io_restore_failed" = "no" ]
}

restore_cpu_state() {
  cpu_restore_failed="no"

  for record in $cpu_snapshot; do
    path="${record%:*}"
    value="${record##*:}"

    if ! printf '%s\\n' "$value" > "$path" 2>/dev/null ||
       [ "$(cat "$path" 2>/dev/null)" != "$value" ]; then
      echo "WARNING: Could not restore CPU: $path" >&2
      cpu_restore_failed="yes"
    fi
  done

  [ "$cpu_restore_failed" = "no" ]
}

restore_kernel_state() {
  restore_failed="no"

  if ! restore_io_state; then
    restore_failed="yes"
  fi

  if ! restore_cpu_state; then
    restore_failed="yes"
  fi

  if [ "$snapshot_complete" != "yes" ]; then
    echo "WARNING: Original kernel snapshot was incomplete" >&2
    restore_failed="yes"
  fi

  [ "$restore_failed" = "no" ]
}

restore_xiaomi() {
  case "$original_xiaomi" in
    NORMAL|ECONOMY|BOOST)
      if /system/bin/sh "$XIAOMI" SET "$original_xiaomi" >/dev/null 2>&1; then
        echo "Xiaomi Parts restored: $original_xiaomi" >&2
        return 0
      fi
      ;;
  esac

  echo "WARNING: Xiaomi Parts could not be restored automatically" >&2
  return 1
}

recover_integrated_state() {
  recovery_failed="no"
  kernel_restore_allowed="yes"

  # Make CPU policies accessible before restoring governors.
  # Xiaomi Parts remains responsible for CPU online/offline decisions.
  if [ "$xiaomi_ready" = "yes" ]; then
    if ! /system/bin/sh "$XIAOMI" SET NORMAL >/dev/null 2>&1; then
      echo "WARNING: Could not prepare Xiaomi Parts NORMAL for recovery" >&2
      recovery_failed="yes"
      kernel_restore_allowed="no"
    else
      recovery_wait=0
      kernel_restore_allowed="no"

      while [ "$recovery_wait" -lt 40 ]; do
        recovery_policies_ready="yes"

        for record in $cpu_snapshot; do
          path="${record%:*}"

          if [ ! -r "$path" ] ||
             [ -z "$(cat "$path" 2>/dev/null)" ]; then
            recovery_policies_ready="no"
            break
          fi
        done

        if [ "$recovery_policies_ready" = "yes" ]; then
          kernel_restore_allowed="yes"
          break
        fi

        recovery_wait=$((recovery_wait + 1))
        sleep 0.2
      done

      if [ "$kernel_restore_allowed" != "yes" ]; then
        echo "WARNING: CPU policies unavailable during recovery" >&2
        recovery_failed="yes"
      fi
    fi
  fi

  # I/O restoration does not depend on CPU policy availability.
  if ! restore_io_state; then
    recovery_failed="yes"
  fi

  if [ "$kernel_restore_allowed" = "yes" ]; then
    if ! restore_cpu_state; then
      recovery_failed="yes"
    fi
  else
    echo "WARNING: CPU restoration skipped because preparation failed" >&2
    recovery_failed="yes"
  fi

  # Restore the original Xiaomi mode after governor restoration.
  if [ "$xiaomi_ready" = "yes" ]; then
    if ! restore_xiaomi; then
      recovery_failed="yes"
    fi
  fi

  if [ "$snapshot_complete" != "yes" ]; then
    recovery_failed="yes"
  fi

  if [ "$recovery_failed" = "yes" ]; then
    echo "RECOVERY=PARTIAL" >&2
    return 1
  fi

  echo "RECOVERY=OK" >&2
  return 0
}

# Recovery and independent I/O operations are kernel-only.
# They never query or modify Xiaomi Parts and never alter boot persistence.
if [ "$mode" = "recovery" ] || [ "$mode" = "io-only" ]; then
  /system/bin/sh "$PROFILES" "$@" || exit 1
  echo "XIAOMI_SYNC=SKIPPED:IO_ONLY"
  exit 0
fi

# Capture the original kernel state before Xiaomi Parts changes anything.
capture_kernel_state

# Companion is optional. Query it only when this profile actually
# requests Xiaomi Parts synchronization.
if [ "$xmode" != "none" ]; then
  query_result="$(/system/bin/sh "$XIAOMI" QUERY 2>/dev/null)"
  if [ "$?" -eq 0 ]; then
    case "$query_result" in
      XIAOMI_PROFILE=NORMAL|XIAOMI_PROFILE=ECONOMY|XIAOMI_PROFILE=BOOST)
        original_xiaomi="${query_result#XIAOMI_PROFILE=}"
        ;;
      *)
        original_xiaomi=""
        ;;
    esac

    if [ -n "$original_xiaomi" ]; then
      xiaomi_ready="yes"
    else
      status="SKIPPED:COMPANION_UNAVAILABLE"
    fi
  else
    status="SKIPPED:COMPANION_UNAVAILABLE"
  fi
else
  status="SKIPPED:NO_SYNC_REQUESTED"
fi

# Only a working Companion bridge enters the Xiaomi transition path.
# Otherwise the requested kernel CPU + I/O profile is still applied.
if [ "$xiaomi_ready" = "yes" ]; then
  # Bring any offlined clusters back before touching their governors.
  # For Economy specifically, use NORMAL temporarily, then reapply Economy last.
  if [ "$xmode" = "ECONOMY" ]; then
    # Prepare all CPU policies before applying ECONOMY governors.
    if /system/bin/sh "$XIAOMI" SET NORMAL >/dev/null 2>&1; then
      status="PREPARED"
    else
      status="UNAVAILABLE"
    fi
  else
    if /system/bin/sh "$XIAOMI" SET "$xmode" >/dev/null 2>&1; then
      status="OK:$xmode"
    else
      status="UNAVAILABLE"
    fi
  fi
fi
# Stop if Xiaomi Parts accepted the bridge but failed the requested transition.
# Do not continue with a potentially inconsistent CPU configuration.
if [ "$xiaomi_ready" = "yes" ] && [ "$status" = "UNAVAILABLE" ]; then
  echo "ERROR: Xiaomi Parts transition failed; kernel profile not applied" >&2
  recover_integrated_state || :
  echo "XIAOMI_SYNC=UNAVAILABLE"
  exit 1
fi

# HEARTHROOT_CPU_WAKE_WAIT_V1
# An IPC success may precede cpufreq policy availability.
# Do not declare full synchronization if any policy fails to wake in time.
cpu_wait_state="READY"
if [ "$xiaomi_ready" = "yes" ]; then
  cpu_wait_state="TIMEOUT"
  wake_attempt=0
  while [ "$wake_attempt" -lt 40 ]; do
    policies_ready="yes"

    # Ensure Xiaomi Parts has brought all CPU cores online.
    for cpu in 1 2 3 4 5 6 7; do
      online_file="/sys/devices/system/cpu/cpu${cpu}/online"

      if [ ! -r "$online_file" ] ||
         [ "$(cat "$online_file" 2>/dev/null)" != "1" ]; then
        policies_ready="no"
        break
      fi
    done

    if [ "$policies_ready" != "yes" ]; then
      wake_attempt=$((wake_attempt + 1))
      sleep 0.2
      continue
    fi

    for name in policy0 policy4 policy7; do
      policy="/sys/devices/system/cpu/cpufreq/$name"
      file="$policy/scaling_available_governors"
      governor_file="$policy/scaling_governor"

      if [ ! -f "$file" ] || [ ! -f "$governor_file" ]; then
        policies_ready="no"
        break
      fi

      available="$(cat "$file" 2>/dev/null)" || {
        policies_ready="no"
        break
      }

      if [ -z "$available" ]; then
        policies_ready="no"
        break
      fi

      active_governor="$(cat "$governor_file" 2>/dev/null)" || {
        policies_ready="no"
        break
      }
      if [ -z "$active_governor" ]; then
        policies_ready="no"
        break
      fi
    done

    if [ "$policies_ready" = "yes" ]; then
      cpu_wait_state="READY"
      break
    fi

    wake_attempt=$((wake_attempt + 1))
    sleep 0.2
  done
  if [ "$cpu_wait_state" != "READY" ]; then
    echo "ERROR: Required CPU policies did not become accessible" >&2
    recover_integrated_state || :
    echo "XIAOMI_SYNC=PARTIAL:$xmode:CPU_NOT_READY"
    exit 1
  fi
fi
# Kernel writes remain in existing, validated profile script.
/system/bin/sh "$PROFILES" "$@" || {
  echo "ERROR: Kernel profile failed; attempting recovery" >&2
  recover_integrated_state || :
  echo "XIAOMI_SYNC=PARTIAL:KERNEL_FAILED"
  exit 1
}
if [ "$xiaomi_ready" = "yes" ] && [ "$xmode" = "ECONOMY" ]; then
  if /system/bin/sh "$XIAOMI" SET ECONOMY >/dev/null 2>&1; then
    if [ "$cpu_wait_state" = "READY" ]; then
      status="OK:ECONOMY"
    else
      status="PARTIAL:ECONOMY:CPU_NOT_READY"
    fi
  else
    echo "ERROR: Final ECONOMY transition failed after kernel changes" >&2
    recover_integrated_state || :
    echo "XIAOMI_SYNC=PARTIAL:ECONOMY_SET_FAILED"
    exit 1
  fi
fi
if [ "$xiaomi_ready" = "yes" ] && [ "$cpu_wait_state" != "READY" ] && [ "$xmode" != "ECONOMY" ] && [ "$status" != "UNAVAILABLE" ]; then
  status="PARTIAL:$xmode:CPU_NOT_READY"
fi
printf 'XIAOMI_SYNC=%s\n' "$status"
