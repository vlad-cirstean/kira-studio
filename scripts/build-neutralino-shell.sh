#!/bin/sh
# Builds neutralino/resources/ from the app's existing electron-vite renderer
# build (out/renderer/), for the P51 walking-skeleton spike. See
# docs/v1/plans/P51-neutralino-migration-spike.md — this script only ever reads
# out/renderer/, never writes to it, and out/ itself is untouched.
set -eu

repo_root=$(cd "$(dirname "$0")/.." && pwd)
renderer_dir="$repo_root/out/renderer"
shell_dir="$repo_root/neutralino"
resources_dir="$shell_dir/resources"

if [ ! -f "$renderer_dir/index.html" ]; then
  echo "error: $renderer_dir/index.html not found — run 'bun run build' first" >&2
  exit 1
fi

rm -rf "$resources_dir/assets" "$resources_dir/index.html" "$resources_dir/kira-stub.js"
cp -r "$renderer_dir/assets" "$resources_dir/assets"
cp "$renderer_dir/index.html" "$resources_dir/index.html"
cp "$shell_dir/kira-stub.js" "$resources_dir/kira-stub.js"

# Idempotent: only inject the stub <script> tag if it isn't already there.
if ! grep -q 'kira-stub.js' "$resources_dir/index.html"; then
  awk '
    /<script type="module"/ && !done {
      print "    <script src=\"./kira-stub.js\"></script>"
      done = 1
    }
    { print }
  ' "$renderer_dir/index.html" > "$resources_dir/index.html"
fi

echo "neutralino/resources/ built from out/renderer/"
