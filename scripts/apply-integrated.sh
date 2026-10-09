#!/system/bin/sh
# Single entrypoint: preserve ordered kernel governor + Xiaomi Parts transitions.
# Normal/Boost wake CPU clusters BEFORE applying governors; Economy applies AFTER.
MODDIR="/data/adb/modules/hearthroot.control"
PROFILES="$MODDIR/scripts/profiles.sh"
XIAOMI="$MODDIR/scripts/xiaomi-sync.sh"
mode="${1:-}"
xmode="none"
case "$mode" in
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
 *) echo "Usage: apply-integrated.sh {native|balanced|battery|performance|custom cpu io [none|normal|economy|boost]}" >&2; exit 2;;
esac
[ "$(id -u)" = 0 ] || { echo "Root required" >&2; exit 1; }
# XIAOMI_BRIDGE_GUARD_V1
# A live QUERY is the reliable check for LSPosed hook + Companion availability.
# The manager APK being installed is NOT proof that the hook is loaded.
# Never perform SET or start Xiaomi Parts if the query fails.
status="SKIPPED:NO_SYNC_REQUESTED"
xiaomi_ready="no"
if [ "$xmode" != "none" ]; then
  if /system/bin/sh "$XIAOMI" QUERY >/dev/null 2>&1; then
    xiaomi_ready="yes"
  else
    status="SKIPPED:BRIDGE_OFFLINE"
  fi
fi
if [ "$xiaomi_ready" = "yes" ]; then
  # Bring any offlined clusters back before touching their governors.
  # For Economy specifically, use NORMAL temporarily, then reapply Economy last.
  if [ "$xmode" = "ECONOMY" ]; then
    current="$(cat /sys/devices/system/cpu/online 2>/dev/null)"
    if [ "$current" != "0-7" ]; then
      if /system/bin/sh "$XIAOMI" SET NORMAL >/dev/null 2>&1; then
        status="PREPARED"
      else
        status="UNAVAILABLE"
      fi
    fi
  else
    if /system/bin/sh "$XIAOMI" SET "$xmode" >/dev/null 2>&1; then
      status="OK:$xmode"
    else
      status="UNAVAILABLE"
    fi
  fi
fi
# HEARTHROOT_CPU_WAKE_WAIT_V1
# An IPC success may precede cpufreq policy availability.
# Do not declare full synchronization if any policy fails to wake in time.
cpu_wait_state="READY"
if [ "$xiaomi_ready" = "yes" ]; then
  cpu_wait_state="TIMEOUT"
  wake_attempt=0
  while [ "$wake_attempt" -lt 8 ]; do
    policies_ready="yes"
    for policy in /sys/devices/system/cpu/cpufreq/policy*; do
      [ -f "$policy/scaling_available_governors" ] || continue
      available="$(cat "$policy/scaling_available_governors" 2>/dev/null)" || {
        policies_ready="no"
        break
      }
      [ -n "$available" ] || { policies_ready="no"; break; }
    done
    if [ "$policies_ready" = "yes" ]; then
      cpu_wait_state="READY"
      break
    fi
    wake_attempt=$((wake_attempt + 1))
    sleep 1
  done
  if [ "$cpu_wait_state" != "READY" ]; then
    echo "WARNING: CPU policies did not all become accessible; applying active policies only" >&2
  fi
fi
# Kernel writes remain in existing, validated profile script.
/system/bin/sh "$PROFILES" "$@" || {
  echo "ERROR: Kernel profile failed; Xiaomi Parts may have changed. Check diagnostics." >&2
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
    status="UNAVAILABLE"
  fi
fi
if [ "$xiaomi_ready" = "yes" ] && [ "$cpu_wait_state" != "READY" ] && [ "$xmode" != "ECONOMY" ]; then
  status="PARTIAL:$xmode:CPU_NOT_READY"
fi
printf 'XIAOMI_SYNC=%s\n' "$status"
