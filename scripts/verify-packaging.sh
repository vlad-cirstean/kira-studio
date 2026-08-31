#!/bin/sh
# verify-packaging.sh — the executable form of P15's "auto-update configuration verified"
# deliverable (docs/v1/plans/P15-gh-tooling.md §2, §4). Runs on Linux and macOS, locally and in CI.
#
# Rewritten for the Wails/Go shell (P57 M7/§4.13): electron-builder.yml and every check that read
# it are gone — there is no updater feed format, no Electron fuses, no asar to unpack a native
# module out of. What survives is the *property* those checks protected (no auto-update, ad-hoc
# signed, correct bundle identity) reasserted against the Wails bundle's own layout.
#
# Static checks (S1-S5) always run. Artifact checks (A1-A4, N1-N2) run only when the bundle exists;
# otherwise they print "skipped" and pass.
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

# --- S5: the packaging script cannot publish ---------------------------------------------------
PACKAGE_SCRIPT="$(node -p "require('./package.json').scripts['package'] || ''")"
case "$PACKAGE_SCRIPT" in
  *"wails3 task darwin:package"*) ;;
  *) fail "package script changed" "package.json's 'package' script no longer runs 'wails3 task darwin:package' — this check needs updating along with it" ;;
esac

APP="shell/bin/Kira Studio.app"

# --- Artifact checks (only if the bundle exists) -----------------------------------------------
if [ ! -d "$APP" ]; then
  note "skipped A1-A4/N1-N2 — \"$APP\" not present (run 'bun run package' first)"
else
  # A1: ad-hoc signature, on both the bundle and its two nested executables (§4.13's extension of
  # the old single-target check — a Wails bundle carries a vendored node binary and, once P58's
  # predecessor vendors one, a Kafka native module, each independently signed before the whole
  # bundle is deep-signed over them).
  if command -v codesign >/dev/null 2>&1; then
    for target in "$APP" "$APP/Contents/MacOS/runtime/node/bin/node"; do
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

  # A2: the engine bundle and the vendored node binary are present at their expected paths
  # (main.go's resolveEngine() looks for both next to the running executable — see
  # shell/build/darwin/Taskfile.yml's create:app:bundle). Node's node_modules resolution for
  # @confluentinc/kafka-javascript (external to the esbuild bundle, P52 §10.1) is NOT checked
  # here: no build step vendors it into the packaged bundle. This used to be a real
  # runtime-failure gap (a packaged Kafka connection would `require()`-fail in the Node engine);
  # it stopped being one at P58e M9.3, when Kafka became a native Go adapter served in-process and
  # stopped reaching the Node engine child at all. The block below (and A4) checks for a module
  # that can no longer matter either way — kept as dead code until P58f deletes the Node engine
  # sidecar and this check along with it.
  if [ ! -f "$APP/Contents/MacOS/runtime/engine/engine.cjs" ]; then
    fail "engine.cjs missing" "\"$APP/Contents/MacOS/runtime/engine/engine.cjs\" is missing"
  fi
  if [ ! -x "$APP/Contents/MacOS/runtime/node/bin/node" ]; then
    fail "vendored node missing" "\"$APP/Contents/MacOS/runtime/node/bin/node\" is missing or not executable"
  fi
  KAFKA_NATIVE="$APP/Contents/MacOS/runtime/engine/node_modules/@confluentinc/kafka-javascript/build/Release/confluent-kafka-javascript.node"
  if [ ! -f "$KAFKA_NATIVE" ]; then
    note "\"$KAFKA_NATIVE\" is missing — this module is unused: Kafka is served in-process by a native Go adapter since P58e M9.3, not by the Node engine child, so nothing vendoring it would change (P58f removes this check with the child)"
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

  # A4: if the Kafka driver's native module were ever vendored anyway (see A2's note — it never
  # is, and it no longer needs to be), it would need to be unpacked alongside engine.cjs and never
  # left compressed inside anything this runtime would need to extract at load time — Wails ships
  # a plain directory tree, not an asar, so there is no asar-specific half of this check left
  # (unlike the old A6). Guarded by `-f "$KAFKA_NATIVE"`, so this never runs in practice.
  if [ -f "$KAFKA_NATIVE" ]; then
    if command -v file >/dev/null 2>&1; then
      if ! file "$KAFKA_NATIVE" | grep -q 'Mach-O.*arm64'; then
        fail "kafka native module wrong arch" "\"$KAFKA_NATIVE\" is not a Mach-O arm64 binary"
      fi
    fi
    if command -v codesign >/dev/null 2>&1; then
      if ! codesign -dv --verbose=2 "$KAFKA_NATIVE" 2>&1 | grep -q 'Signature=adhoc'; then
        fail "kafka native module not signed" "codesign on \"$KAFKA_NATIVE\" did not report Signature=adhoc"
      fi
    fi
  fi

  # --- N1: the vendored Node runtime is trimmed (scripts/vendor-node.sh's own guarantee) --------
  NODE_RUNTIME="$APP/Contents/MacOS/runtime/node"
  if [ -d "$NODE_RUNTIME" ]; then
    if [ -d "$NODE_RUNTIME/include" ]; then
      fail "vendored node not trimmed" "\"$NODE_RUNTIME/include\" is present — scripts/vendor-node.sh should have removed it"
    fi
    if [ -d "$NODE_RUNTIME/lib/node_modules/npm" ]; then
      fail "vendored node not trimmed" "\"$NODE_RUNTIME/lib/node_modules/npm\" is present — scripts/vendor-node.sh should have removed it"
    fi
  else
    note "skipped N1 — \"$NODE_RUNTIME\" not present"
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

if [ "$FAILED" = "1" ]; then
  echo "verify-packaging: FAILED — see above" >&2
  exit 1
fi

echo "verify-packaging: all checks passed"
