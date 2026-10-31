#!/usr/bin/env bash
# Installs the OpenDuet APK on an Android device you pick from `adb devices`.
#
#   ./install-android.sh                 # uses OpenDuet-*.apk next to this script
#   ./install-android.sh path/to/app.apk
#
# Works with the macOS system bash (3.2): no mapfile, no associative arrays.
set -euo pipefail

PACKAGE="tech.threatvector.openduet"
ACTIVITY="$PACKAGE/.MainActivity"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

say()  { printf '%s\n' "$*"; }
warn() { printf '%s%s%s\n' "$YELLOW" "$*" "$RESET" >&2; }
die()  { printf '%s%s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# Reads one answer; fails at end of input so a closed stdin can't loop forever.
# Every adb call below gets </dev/null so it can never eat these answers.
ask() {
  local prompt="$1" reply
  printf '%s' "$prompt" >&2
  if ! IFS= read -r reply; then
    printf '\n' >&2
    return 1
  fi
  printf '%s' "$reply"
}

# yes/no with a default: confirm "Question" y|n
confirm() {
  local hint="[y/N]" answer
  [ "$2" = "y" ] && hint="[Y/n]"
  answer="$(ask "$1 $hint ")" || return 1
  answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
  [ -z "$answer" ] && answer="$2"
  [ "$answer" = "y" ] || [ "$answer" = "yes" ]
}

find_adb() {
  if command -v adb >/dev/null 2>&1; then command -v adb; return; fi
  local dir
  for dir in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
    if [ -n "$dir" ] && [ -x "$dir/platform-tools/adb" ]; then printf '%s\n' "$dir/platform-tools/adb"; return; fi
  done
  return 1
}

find_apk() {
  if [ "$#" -gt 0 ]; then
    [ -f "$1" ] || die "No APK at $1."
    printf '%s\n' "$1"; return
  fi
  local apk
  for apk in "$HERE"/OpenDuet-*.apk "$HERE"/OpenDuet.apk "$HERE/../android/app/build/outputs/apk/release/app-release.apk"; do
    if [ -f "$apk" ]; then printf '%s\n' "$apk"; return; fi
  done
  die "Couldn't find the OpenDuet APK. Pass its path: $0 path/to/OpenDuet.apk"
}

ADB="$(find_adb)" || die "adb not found. Install Android platform-tools (brew install android-platform-tools) or set ANDROID_HOME."
# How to name adb in hints: plain "adb" when it's on PATH, the full path otherwise.
ADB_HINT="adb"; [ "$(command -v adb 2>/dev/null || true)" = "$ADB" ] || ADB_HINT="$ADB"
APK="$(find_apk "$@")"

say "${BOLD}OpenDuet Android installer${RESET}"
say "${DIM}APK: $APK${RESET}"
"$ADB" start-server </dev/null >/dev/null 2>&1 || die "adb could not start its server."

SERIALS=(); LABELS=()

# Fills SERIALS/LABELS with devices ready to install on; prints the others with what to do about them.
scan() {
  SERIALS=(); LABELS=()
  local line serial state model device
  while IFS= read -r line; do
    case "$line" in "List of devices"* | "" | "*"*) continue ;; esac
    serial="${line%%[[:space:]]*}"
    state="$(printf '%s\n' "$line" | awk '{print $2}')"
    model="$(printf '%s\n' "$line" | tr ' ' '\n' | sed -n 's/^model://p' | tr '_' ' ')"
    device="$(printf '%s\n' "$line" | tr ' ' '\n' | sed -n 's/^device://p')"
    case "$state" in
      device)
        SERIALS+=("$serial")
        LABELS+=("${model:-Unknown device} ${DIM}($serial${device:+, $device})${RESET}")
        ;;
      unauthorized)
        warn "  $serial: not authorized. Unlock the phone and accept the \"Allow USB debugging\" prompt, then rescan." ;;
      offline)
        warn "  $serial: offline. Reconnect the cable, or run: $ADB_HINT reconnect" ;;
      *)
        warn "  $serial: $state" ;;
    esac
  done < <("$ADB" devices -l </dev/null 2>/dev/null)
}

while :; do
  scan
  if [ "${#SERIALS[@]}" -gt 0 ]; then break; fi
  say ""
  say "No devices ready."
  say "${DIM}Phone: enable Developer options, then USB debugging, and connect it by cable."
  say "Wireless: Developer options, Wireless debugging, then: $ADB_HINT pair <ip:port> and $ADB_HINT connect <ip:port>.${RESET}"
  answer="$(ask "Press Enter to scan again, or q to quit: ")" || exit 1
  [ "$answer" = "q" ] && exit 1
done

say ""
say "Devices:"
i=0
while [ "$i" -lt "${#SERIALS[@]}" ]; do
  printf '  %s%d%s  %s\n' "$BOLD" "$((i + 1))" "$RESET" "${LABELS[$i]}"
  i=$((i + 1))
done
[ "${#SERIALS[@]}" -gt 1 ] && printf '  %sa%s  All of them\n' "$BOLD" "$RESET"

TARGETS=()
while :; do
  if [ "${#SERIALS[@]}" -eq 1 ]; then
    choice="$(ask "Install on device 1? [Y/n] ")" || exit 1
    case "$choice" in "" | y | Y | yes) choice=1 ;; *) exit 1 ;; esac
  else
    choice="$(ask "Install on which device? [1-${#SERIALS[@]}, a for all, q to quit] ")" || exit 1
  fi
  case "$choice" in
    q | Q) exit 1 ;;
    a | A) if [ "${#SERIALS[@]}" -gt 1 ]; then TARGETS=("${SERIALS[@]}"); break; fi ;;
    *[!0-9]* | "") ;;
    *) if [ "$choice" -ge 1 ] && [ "$choice" -le "${#SERIALS[@]}" ]; then TARGETS=("${SERIALS[$((choice - 1))]}"); break; fi ;;
  esac
  warn "Pick a number from the list."
done

# Prints a plain explanation for an adb install failure code.
explain() {
  case "$1" in
    *NO_MATCHING_ABIS*) say "This device's processor type isn't supported by the APK." ;;
    *OLDER_SDK*) say "This device runs an Android version older than 7.0, which OpenDuet needs." ;;
    *USER_RESTRICTED*) say "The phone blocked the install. On Xiaomi/Redmi/POCO, turn on \"Install via USB\" in Developer options." ;;
    *INSUFFICIENT_STORAGE*) say "The device is out of storage." ;;
    *VERIFICATION_FAILURE*) say "Google Play Protect stopped the install. Check the phone for a prompt and choose to install anyway." ;;
    *VERSION_DOWNGRADE*) say "A newer OpenDuet is already installed. Uninstall it first to go back to this version." ;;
    *) say "adb said: $1" ;;
  esac
}

install_on() {
  local serial="$1" out
  say ""
  say "Installing on ${BOLD}$serial${RESET}…"
  out="$("$ADB" -s "$serial" install -r "$APK" </dev/null 2>&1 || true)"
  if printf '%s' "$out" | grep -q "^Success"; then
    say "${GREEN}Installed.${RESET}"
  elif printf '%s' "$out" | grep -qE "INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match"; then
    warn "A copy of OpenDuet signed with a different key is already on this device (for example a debug build)."
    if confirm "Uninstall it and install this one? This deletes its data, including the pairing with your computer." n; then
      "$ADB" -s "$serial" uninstall "$PACKAGE" </dev/null >/dev/null 2>&1 || true
      out="$("$ADB" -s "$serial" install "$APK" </dev/null 2>&1 || true)"
      if printf '%s' "$out" | grep -q "^Success"; then say "${GREEN}Installed.${RESET}"; else explain "$(printf '%s' "$out" | tail -1)"; return 1; fi
    else
      say "Skipped $serial."; return 1
    fi
  else
    printf '%s' "$RED" >&2; explain "$(printf '%s' "$out" | tail -1)" >&2; printf '%s' "$RESET" >&2
    return 1
  fi

  if confirm "Open OpenDuet on $serial now?" n; then
    "$ADB" -s "$serial" shell am start -n "$ACTIVITY" </dev/null >/dev/null 2>&1 || warn "Couldn't open it; find OpenDuet in the app drawer."
  fi
}

failed=0
for serial in "${TARGETS[@]}"; do
  install_on "$serial" || failed=$((failed + 1))
done

say ""
if [ "$failed" -eq 0 ]; then
  say "${GREEN}Done.${RESET} On your computer, open OpenDuet, then Settings, then Phone, and scan the code to pair."
else
  die "$failed of ${#TARGETS[@]} installs did not finish."
fi
