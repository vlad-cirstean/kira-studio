#!/bin/sh
# verify-packaging.sh — the executable form of P15's "auto-update configuration verified"
# deliverable (docs/v1/plans/P15-gh-tooling.md §2, §4). Runs on Linux and macOS, locally and in CI.
#
# Rewritten for the Wails/Go shell (P57 M7/§4.13): electron-builder.yml and every check that read
# it are gone — there is no updater feed format, no Electron fuses, no asar to unpack a native
# module out of. What survives is the *property* those checks protected (no auto-update, ad-hoc
# signed, correct bundle identity) reasserted against the Wails bundle's own layout.
#
# Static checks (S1, S2, S5) always run — S3/S4 were electron-builder.yml checks removed in the
# P57 rewrite; the numbering was never closed up, and check IDs stay as-is since docs/PACKAGING.md
# cross-references them. Artifact checks (A1, A3, A5, N2 over the .app; A4, N3 over the .dmg P10
# ships) run only when that artifact exists; otherwise they print "skipped" and pass.
#
# Every check runs before the script exits, so one run reports everything wrong, not just the
# first failure.
set -eu

FAILED=0

fail() {
  echo "verify-packaging: $1 — $2" >&2
  FAILED=1
}

note() {
  echo "verify-packaging: note — $1"
}

# --- S1: no updater dependency -------------------------------------------------------------
if grep -qE '"(electron-updater|update-electron-app)"' package.json; then
  fail "updater dependency present" "package.json references electron-updater/update-electron-app; SPEC.md §1/§3 defer auto-update past v1"
fi

# --- S2: no updater code in apps/ or packages/ ---------------------------------------------
if grep -rnE "autoUpdater|electron-updater" apps/ packages/ >/dev/null 2>&1; then
  fail "updater code present" "apps/ or packages/ references autoUpdater or electron-updater"
fi

# --- S5: the packaging script cannot publish ---------------------------------------------------
PACKAGE_SCRIPT="$(node -p "require('./package.json').scripts['package'] || ''")"
case "$PACKAGE_SCRIPT" in
  # P10: the shipped artifact is the .dmg, so the script must run the task that builds one.
  # `darwin:package` alone stops at the .app and would leave the release with nothing to upload —
  # and it is a prefix of this string, so match the full task name, not a substring of it.
  *"wails3 task darwin:package:dmg"*) ;;
  *) fail "package script changed" "package.json's 'package' script no longer runs 'wails3 task darwin:package:dmg' — this check needs updating along with it" ;;
esac

APP="apps/kira-studio/bin/Kira Studio.app"
DMG="apps/kira-studio/bin/Kira Studio.dmg"

# --- Artifact checks (only if the bundle exists) -----------------------------------------------
if [ ! -d "$APP" ]; then
  note "skipped A1/A3/A5/N2 — \"$APP\" not present (run 'bun run package' first)"
else
  # A1: ad-hoc signature (P58f: back to the single-target check — no vendored node binary, no
  # nested executable, left to sign independently before the whole bundle is deep-signed).
  if command -v codesign >/dev/null 2>&1; then
    for target in "$APP"; do
      if [ -e "$target" ]; then
        if ! codesign -dv --verbose=2 "$target" 2>&1 | grep -q 'Signature=adhoc'; then
          fail "signature not ad-hoc" "codesign on \"$target\" did not report Signature=adhoc"
        fi
      else
        note "skipped the ad-hoc signature check for \"$target\" — not present"
      fi
    done
  else
    note "skipped A1 — codesign not available on this runner"
  fi

  # A3: bundle identifier (D11 — this is the first milestone this ever passes against a real
  # Wails bundle; before P57 the Wails build shipped the deliberately-distinct
  # com.kirathecat.kira-studio-shell identifier, P51/P52 §3.1).
  if command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
    BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist" 2>/dev/null || echo '')"
    if [ "$BUNDLE_ID" != "com.kirathecat.kira-studio" ]; then
      fail "wrong bundle identifier" "CFBundleIdentifier is '$BUNDLE_ID', expected com.kirathecat.kira-studio"
    fi
  else
    note "skipped A3 — PlistBuddy not available on this runner"
  fi

  # A5: the bundle reports the version build/config.yml holds — the single source both the -ldflags
  # stamp on the binary and create:app:bundle's PlistBuddy step read. A mismatch means a bundle was
  # assembled around a stale plist, or the stamp silently did not run (its PlistBuddy guard).
  if command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
    WANT_VERSION="$(sed -n 's/^  version: *"\([^"]*\)".*/\1/p' apps/kira-studio/build/config.yml | head -1)"
    GOT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo '')"
    if [ "$GOT_VERSION" != "$WANT_VERSION" ]; then
      fail "wrong bundle version" "CFBundleShortVersionString is '$GOT_VERSION', expected '$WANT_VERSION' (apps/kira-studio/build/config.yml's info.version)"
    fi
  else
    note "skipped A5 — PlistBuddy not available on this runner"
  fi

  # --- N2: the whole bundle verifies deep-signed -------------------------------------------------
  if command -v codesign >/dev/null 2>&1; then
    if ! codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
      fail "bundle does not verify" "codesign --verify --deep --strict \"$APP\" did not exit 0"
    fi
  else
    note "skipped N2 — codesign not available on this runner"
  fi
fi

# --- A4/N3: the shipped .dmg (only if it exists) -----------------------------------------------
if [ ! -f "$DMG" ]; then
  note "skipped A4/N3 — \"$DMG\" not present (run 'bun run package' first)"
elif ! command -v codesign >/dev/null 2>&1; then
  note "skipped A4/N3 — codesign not available on this runner"
else
  # A4: the image carries its own ad-hoc signature (scripts/sign-bundle.sh), same property A1
  # asserts for the bundle. No --deep: a disk image is a flat file, not a bundle tree.
  if ! codesign -dv --verbose=2 "$DMG" 2>&1 | grep -q 'Signature=adhoc'; then
    fail "dmg signature not ad-hoc" "codesign on \"$DMG\" did not report Signature=adhoc"
  fi
  # N3: and it verifies.
  if ! codesign --verify --strict "$DMG" >/dev/null 2>&1; then
    fail "dmg does not verify" "codesign --verify --strict \"$DMG\" did not exit 0"
  fi
fi

if [ "$FAILED" = "1" ]; then
  echo "verify-packaging: FAILED — see above" >&2
  exit 1
fi

echo "verify-packaging: all checks passed"
