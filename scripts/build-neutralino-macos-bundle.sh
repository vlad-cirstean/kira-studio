#!/bin/sh
# Builds a real macOS .app bundle (Contents/MacOS, Contents/Resources, Info.plist, .icns
# icon) from Neutralino's own build output.
#
# Why this script exists: `neu build --macos-bundle` does NOT produce a real app bundle —
# it only renames the flat mac binary to `<name>.app` (see
# neutralino/node_modules/@neutralinojs/neu/src/modules/bundler.js, the `macosBundle`
# branch: a bare `fs.renameSync(binary, binary + '.app')`, nothing else). The result has no
# Info.plist, no bundle identifier, no icon, and is a plain file rather than a directory —
# Finder/LaunchServices/Gatekeeper would not treat it as an application. This is a known,
# documented gap in Neutralino's own tooling; the community fills it with an unofficial
# script (hschneider/neutralino-build-scripts' build-mac.sh) that this script is modeled on.
# See docs/v1/plans/P51-neutralino-migration-spike.md §9.2 for the full investigation.
#
# What this script does NOT do: code signing or notarization. `codesign` is an Apple-only
# macOS binary — it does not exist on Linux, so it cannot be exercised here. This is not a
# new constraint Neutralino introduces: scripts/verify-packaging.sh's A3/A5 checks already
# gate on `command -v codesign` / `command -v PlistBuddy` and skip on a non-macOS runner,
# because the existing Electron pipeline has the exact same requirement.
set -eu

repo_root=$(cd "$(dirname "$0")/.." && pwd)
shell_dir="$repo_root/neutralino"
dist_dir="$shell_dir/dist/kira-studio"
config="$shell_dir/neutralino.config.json"
arch="${1:-arm64}"

if [ ! -f "$dist_dir/resources.neu" ]; then
  echo "error: $dist_dir/resources.neu not found — run 'npx neu build --release' in neutralino/ first" >&2
  exit 1
fi

binary="$dist_dir/kira-studio-mac_$arch"
if [ ! -f "$binary" ]; then
  echo "error: $binary not found — did 'neu build' fetch mac_$arch binaries (see neutralino/bin/)?" >&2
  exit 1
fi

if ! command -v png2icns >/dev/null 2>&1; then
  echo "error: png2icns not found (Debian/Ubuntu: apt-get install icnsutils) — needed to convert build/icon.png to .icns" >&2
  exit 1
fi

app_name="Kira Studio"
app_identifier=$(jq -r '.applicationId' "$config")
app_version=$(jq -r '.version' "$config")
min_os="13.0" # SPEC.md §3 "macOS 13+", matches electron-builder.yml's minimumSystemVersion

out_dir="$dist_dir/mac_$arch"
bundle="$out_dir/$app_name.app"
rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"

cp "$binary" "$bundle/Contents/MacOS/kira-studio"
chmod 755 "$bundle/Contents/MacOS/kira-studio"
cp "$dist_dir/resources.neu" "$bundle/Contents/Resources/resources.neu"

icns="$repo_root/.tmp-neutralino-icon.icns"
rm -f "$icns"
png2icns "$icns" "$repo_root/build/icon.png" >/dev/null
mv "$icns" "$bundle/Contents/Resources/appIcon.icns"

cat > "$bundle/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$app_name</string>
  <key>CFBundleDisplayName</key><string>$app_name</string>
  <key>CFBundleIdentifier</key><string>$app_identifier</string>
  <key>CFBundleVersion</key><string>$app_version</string>
  <key>CFBundleShortVersionString</key><string>$app_version</string>
  <key>CFBundleExecutable</key><string>kira-studio</string>
  <key>CFBundleIconFile</key><string>appIcon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>$min_os</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

echo "built $bundle"
