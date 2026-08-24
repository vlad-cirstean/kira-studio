#!/bin/sh
# verify-packaging.sh — the executable form of P15's "auto-update configuration verified"
# deliverable (docs/plans/P15-gh-tooling.md §2, §4). Runs on Linux and macOS, locally and in CI.
#
# Static checks (S1-S5) always run. Artifact checks (A1-A5) run only when dist/ exists; otherwise
# they print "skipped" and pass. Set KIRA_STRICT_UPDATE_CHECK=1 to make a leftover .blockmap
# fatal (A2) instead of a reported note — the release workflow sets this after deleting them.
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

# --- S2: no updater code in src/ -----------------------------------------------------------
if grep -rnE "autoUpdater|electron-updater" src/ >/dev/null 2>&1; then
  fail "updater code present" "src/ references autoUpdater or electron-updater"
fi

# --- S3: dmg.writeUpdateInfo: false is intact -----------------------------------------------
if ! grep -qE '^\s*writeUpdateInfo:\s*false' electron-builder.yml; then
  fail "writeUpdateInfo not false" "electron-builder.yml no longer sets dmg.writeUpdateInfo: false"
fi

# --- S4: no publish configuration ------------------------------------------------------------
if grep -qE '^\s*publish:' electron-builder.yml; then
  fail "publish configuration present" "electron-builder.yml has a publish: key; v1 ships with none"
fi

# --- S5: packaging scripts cannot publish -----------------------------------------------------
for name in package:mac package:mac:dir; do
  script="$(node -p "require('./package.json').scripts['$name'] || ''")"
  case "$script" in
    *"--publish never"*) ;;
    *) fail "$name missing --publish never" "package.json script '$name' does not pass --publish never" ;;
  esac
done

# --- Artifact checks (only if dist/ exists) ---------------------------------------------------
if [ ! -d dist ]; then
  note "skipped A1-A5 — no dist/ build present"
else
  # A1: no update feed file
  if ls dist/latest*.yml >/dev/null 2>&1; then
    fail "update feed present" "dist/latest*.yml exists — electron-builder wrote an auto-update feed"
  fi

  # A2: no differential-update payload (warning unless KIRA_STRICT_UPDATE_CHECK=1)
  if ls dist/*.blockmap >/dev/null 2>&1; then
    if [ "${KIRA_STRICT_UPDATE_CHECK:-}" = "1" ]; then
      fail "blockmap present (strict mode)" "dist/*.blockmap exists — a differential-update artifact must not reach a release; see docs/PACKAGING.md §7"
    else
      note "dist/*.blockmap exists — electron-builder writes this unconditionally for the mac zip target (harmless without a feed file); see docs/PACKAGING.md §7. Set KIRA_STRICT_UPDATE_CHECK=1 to make this fatal."
    fi
  fi

  APP="dist/mac-arm64/Kira Studio.app"

  # A3: ad-hoc signature
  if command -v codesign >/dev/null 2>&1; then
    if [ -d "$APP" ]; then
      if ! codesign -dv --verbose=2 "$APP" 2>&1 | grep -q 'Signature=adhoc'; then
        fail "signature not ad-hoc" "codesign on \"$APP\" did not report Signature=adhoc"
      fi
    else
      note "skipped A3 — \"$APP\" not present"
    fi
  else
    note "skipped A3 — codesign not available on this runner"
  fi

  # A4: engine unpacked
  if [ -d "$APP" ]; then
    if [ ! -f "$APP/Contents/Resources/app.asar.unpacked/out/main/engine.js" ]; then
      fail "engine.js not unpacked" "\"$APP/Contents/Resources/app.asar.unpacked/out/main/engine.js\" is missing"
    fi
  else
    note "skipped A4 — \"$APP\" not present"
  fi

  # A5: bundle identifier
  if command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
    if [ -d "$APP" ]; then
      BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist" 2>/dev/null || echo '')"
      if [ "$BUNDLE_ID" != "com.kirathecat.kira-studio" ]; then
        fail "wrong bundle identifier" "CFBundleIdentifier is '$BUNDLE_ID', expected com.kirathecat.kira-studio"
      fi
    else
      note "skipped A5 — \"$APP\" not present"
    fi
  else
    note "skipped A5 — PlistBuddy not available on this runner"
  fi

  # A6: the Kafka driver's native module is unpacked, and only there (P32 D7) — Electron cannot
  # dlopen a native addon from inside an asar archive, so a .node left inside app.asar would make
  # every Kafka connection fail at runtime with no build-time signal.
  if [ -d "$APP" ]; then
    UNPACKED_NATIVE="$APP/Contents/Resources/app.asar.unpacked/node_modules/@confluentinc/kafka-javascript/build/Release/confluent-kafka-javascript.node"
    if [ ! -f "$UNPACKED_NATIVE" ]; then
      fail "kafka driver not unpacked" "\"$UNPACKED_NATIVE\" is missing"
    fi
    ASAR="$APP/Contents/Resources/app.asar"
    if [ -f "$ASAR" ] && command -v npx >/dev/null 2>&1; then
      if npx --yes asar list "$ASAR" 2>/dev/null | grep -q '@confluentinc/kafka-javascript/build/Release/.*\.node$'; then
        fail "kafka driver inside app.asar" "\"$ASAR\" contains a .node under @confluentinc/kafka-javascript — it must be asarUnpack'd, not bundled"
      fi
    else
      note "skipped the app.asar contents half of A6 — no asar CLI available on this runner"
    fi
  else
    note "skipped A6 — \"$APP\" not present"
  fi
fi

if [ "$FAILED" = "1" ]; then
  echo "verify-packaging: FAILED — see above" >&2
  exit 1
fi

echo "verify-packaging: all checks passed"
