#!/system/bin/sh
# Hearthroot Control: optional Companion installer (BakaSU/KernelSU/Magisk).
# This file is sourced by the module manager AFTER extracting the ZIP.
# Do not exit/abort when optional dependencies are missing.

hr_print() { ui_print "$1"; }
hr_print ' '
hr_print '========================================'
hr_print '       H E A R T H R O O T'
hr_print '             CONTROL'
hr_print '========================================'
hr_version="$(sed -n 's/^version=//p' "$MODPATH/module.prop" 2>/dev/null | head -n 1)"
hr_print "- Build: ${hr_version:-unknown}"
hr_print '- Kernel CPU/I/O profile engine: included'
hr_print '- Native / Balanced / Battery / Performance'
hr_print '- Experimental: manual CPU/I/O, optional Xiaomi sync'
hr_print '- Xiaomi bridge: guarded (non-mandatory)'
hr_print '- Extreme / thermal bypass: excluded'

# LSPosed's installed module file is only informative. The LIVE bridge QUERY
# performed at Apply time is authoritative; installing LSPosed != ready hook.
hr_lsposed='NOT_DETECTED'
for hr_dir in /data/adb/modules/* /data/adb/modules_update/*; do
  [ -f "$hr_dir/module.prop" ] || continue
  if grep -Eiq '^(id|name)=.*lsposed' "$hr_dir/module.prop" 2>/dev/null; then
    if [ -f "$hr_dir/disable" ]; then
      hr_lsposed='INSTALLED_DISABLED'
    else
      hr_lsposed='INSTALLED_NOT_VERIFIED'
    fi
    break
  fi
done
hr_print "- LSPosed module: $hr_lsposed"
hr_print '- Live hook detection: automatic at Apply'
hr_print ' '

hr_apk="$MODPATH/companion/Hearthroot-Companion.apk"
hr_package='dev.hearthroot.companion'
hr_choice='SKIP'

# Existing Companion installations are preserved unless Volume UP is chosen.
# Never uninstall to bypass a mismatched APK signing key.
hr_existing='no'
if /system/bin/pm path "$hr_package" 2>/dev/null | grep -q '^package:'; then
  hr_existing='yes'
  hr_print '- Companion: already installed'
fi
if [ ! -s "$hr_apk" ]; then
  hr_print '- Companion APK: not included in this ZIP'
  hr_print '- Companion: SKIPPED (keeping current installation if present)'
else
  if [ "$hr_existing" = 'yes' ]; then
    hr_print '- Companion: update is optional; existing app will be preserved'
  fi
  hr_print '----------------------------------------'
  hr_print '  OPTIONAL: HEARTHROOT COMPANION APK'
  hr_print '  Volume UP   : Install / update APK'
  hr_print '  Volume DOWN : Skip / keep current app'
  hr_print '  No response : Skip automatically'
  hr_print '----------------------------------------'
  hr_timeout=''
  if [ -x /system/bin/timeout ]; then
    hr_timeout='/system/bin/timeout'
  elif command -v timeout >/dev/null 2>&1; then
    hr_timeout='timeout'
  fi
  # Bound every read and the total prompt duration. Never hang manager setup.
  if [ -x /system/bin/getevent ] && [ -n "$hr_timeout" ]; then
    hr_deadline=$(( $(date +%s) + 18 ))
    hr_attempts=0
    while [ "$(date +%s)" -lt "$hr_deadline" ] && [ "$hr_attempts" -lt 180 ]; do
      hr_attempts=$((hr_attempts + 1))
      hr_event="$($hr_timeout 1 /system/bin/getevent -qlc 1 2>/dev/null || :)"
      case "$hr_event" in
        *KEY_VOLUMEUP*DOWN*|*KEY_VOLUMEUP*00000001*)
          hr_choice='INSTALL'
          break ;;
        *KEY_VOLUMEDOWN*DOWN*|*KEY_VOLUMEDOWN*00000001*)
          hr_choice='SKIP'
          break ;;
      esac
    done
  else
    hr_print '- Volume input unavailable: default SKIP'
  fi
  if [ "$hr_choice" = 'INSTALL' ]; then
    hr_print '- Companion: installing user-selected APK...'
    # pm install failure MUST NOT fail module installation.
    if hr_install_result="$(/system/bin/pm install -r "$hr_apk" 2>&1)"; then
      hr_install_rc=0
    else
      hr_install_rc=$?
    fi
    if [ "$hr_install_rc" -eq 0 ] && printf '%s' "$hr_install_result" | grep -q 'Success'; then
      hr_print '- Companion: INSTALLED'
      hr_print '- Enable its scope in LSPosed and reboot to activate the hook.'
    else
      hr_print '- Companion: INSTALL FAILED (Hearthroot Control unaffected)'
      hr_print "- Package Manager: $(printf '%s' "$hr_install_result" | head -c 160)"
      hr_print '- You may install the bundled APK manually after reboot.'
    fi
  else
    if [ "$hr_existing" = 'yes' ]; then
      hr_print '- Companion: EXISTING INSTALLATION PRESERVED'
    else
      hr_print '- Companion: SKIPPED BY USER / TIMEOUT'
    fi
  fi
fi
hr_print ' '
hr_print '- CPU/I/O profiles: standalone, no LSPosed requirement'
hr_print '- Xiaomi Parts: skipped if Companion bridge is offline'
hr_print '- Apply on boot: controlled by existing WebUI setting'
hr_print '========================================'
hr_print '         INSTALLATION COMPLETE'
hr_print '========================================'
