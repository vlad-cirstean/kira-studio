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

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"
cd "$ROOT_DIR"

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

# --- S6: the packaged frontend bundle does not carry the Playwright debug hooks ----------------
# P29 F1/§2.1's trap: build/Taskfile.yml's build:frontend task fingerprints its `sources` (frontend
# excluding node_modules/dist), not `dist` itself, so `bun run test:ui` (build:test, hooks on) then
# `bun run package` with no intervening source edit would otherwise let Task's up-to-date check
# skip the rebuild and embed the hooks-enabled bundle. Checked against frontend/dist rather than
# the .app bundle so this also runs on Linux and before packaging.
# __kiraScrollTrace is deliberately excluded — its console.warn string literal survives in
# scrollTrace.ts's always-shipped note* half, so it would be a false positive; the five below
# appear nowhere outside main.ts's __KIRA_DEBUG_HOOKS__-gated block.
if [ -d apps/kira-studio/frontend/dist/assets ]; then
  if grep -lE '__kiraCount|__kiraCacheStats|__kiraRetention|__kiraRetainedBytes|__kiraTreeConnectionIds' \
      apps/kira-studio/frontend/dist/assets/*.js >/dev/null 2>&1; then
    fail "debug hooks in packaged bundle" "frontend/dist/assets/*.js carries the Playwright debug hooks — rebuild with 'bun run build', not 'build:test'"
  fi
else
  note "skipped S6 — apps/kira-studio/frontend/dist/assets not present (run 'bun run build' first)"
fi

# --- S7: no un-gated debug global in main.ts ----------------------------------------------------
# Every window.__kira* assignment in main.ts must sit inside the `if (__KIRA_DEBUG_HOOKS__)` block
# (P29 F1) — this is the static check that would have caught window.__kiraGridEngine shipping
# unconditionally, and would catch the next hook added the same way.
MAIN_TS="apps/kira-studio/frontend/src/main.ts"
if [ -f "$MAIN_TS" ]; then
  GATE_LINE="$(grep -n '^if (__KIRA_DEBUG_HOOKS__)' "$MAIN_TS" | head -1 | cut -d: -f1)"
  if [ -z "$GATE_LINE" ]; then
    fail "no debug-hook gate" "$MAIN_TS has no top-level 'if (__KIRA_DEBUG_HOOKS__)' block"
  else
    UNGATED="$(awk -v gate="$GATE_LINE" 'NR < gate && /^[[:space:]]*window\.__kira/' "$MAIN_TS")"
    if [ -n "$UNGATED" ]; then
      fail "un-gated debug global" "$MAIN_TS assigns window.__kira* before its __KIRA_DEBUG_HOOKS__ gate at line $GATE_LINE"
    fi
  fi
else
  fail "main.ts missing" "$MAIN_TS not found — this check needs updating along with it"
fi

# --- S8: no dev-mode env branch in shipped Go's own entry point --------------------------------
# apps/kira-studio/main.go must read no os.Getenv at all — true after P29 F2 deleted the
# KIRA_G1_BLANK branch. A precise, low-false-positive invariant for the app's own entry point.
MAIN_GO="apps/kira-studio/main.go"
if [ -f "$MAIN_GO" ]; then
  if grep -q 'os\.Getenv' "$MAIN_GO"; then
    fail "dev-mode env branch in main.go" "$MAIN_GO calls os.Getenv — the app's own entry point must read no env-driven dev/debug branch"
  fi
else
  fail "main.go missing" "$MAIN_GO not found — this check needs updating along with it"
fi

# --- S5: the packaging script cannot publish ---------------------------------------------------
# A POSIX `sed` read, not `node -p require(...)`: this repository does not declare `node` as a
# dependency anywhere (P58f deleted the vendored runtime), so a machine that satisfies every
# documented Requirement could still fail this script at line 1 before a single check ran (P20 F13).
PACKAGE_SCRIPT="$(sed -n 's/^[[:space:]]*"package": *"\(.*\)",\{0,1\}$/\1/p' package.json | head -1)"
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
