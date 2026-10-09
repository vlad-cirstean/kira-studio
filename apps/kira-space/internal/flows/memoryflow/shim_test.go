package memoryflow_test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

// shimScript fronts the fake claude for headless `-p` calls. The fake prints a stream-json init line
// that `--output-format json` callers cannot parse, and it reads --mcp-config as a file while the
// importer passes the JSON inline; the shim fixes both. Where the shim directory holds a canned
// answer it prints that instead of running the fake: gate.json, reconcile.json, extract-<file>.json.
// A finalize run exports KIRA_DOC (the document name) down to the memory-mcp gate, which then
// prefers gate-<file>.json. fail-<file> counts extract calls that spend their budget before one
// succeeds. While hold exists and release does not, extract calls block.
const shimScript = `#!/bin/bash
real=%q
d=%q
case " $* " in *" -p "*) ;; *) exec "$real" "$@";; esac
in=$(cat)
sys=""; prev=""; args=()
for a in "$@"; do
  [ "$prev" = "--system-prompt" ] && sys="$a"
  if [ "$prev" = "--mcp-config" ]; then
    printf '%%s' "$a" > "$d/mcp-$$.json"; a="$d/mcp-$$.json"
  fi
  args+=("$a"); prev="$a"
done
case "$sys" in
*"gatekeeper of a long-term memory"*)
  if [ -n "$KIRA_DOC" ] && [ -f "$d/gate-$KIRA_DOC.json" ]; then cat "$d/gate-$KIRA_DOC.json"; exit 0; fi
  if [ -f "$d/gate.json" ]; then cat "$d/gate.json"; exit 0; fi;;
*"reconcile new facts"*)
  if [ -f "$d/reconcile.json" ]; then cat "$d/reconcile.json"; exit 0; fi;;
*"extract durable facts"*)
  name=$(printf '%%s' "$in" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4)
  name=$(basename "$name")
  while [ -f "$d/hold" ] && [ ! -f "$d/release" ]; do sleep 0.05; done
  left=$(cat "$d/fail-$name" 2>/dev/null || echo 0)
  if [ "$left" -gt 0 ]; then
    echo $(( left - 1 )) > "$d/fail-$name"
    echo '{"type":"result","subtype":"error_max_budget_usd","is_error":true}'
    exit 0
  fi
  if [ -f "$d/extract-$name.json" ]; then cat "$d/extract-$name.json"; exit 0; fi;;
esac
set -o pipefail
KIRA_DOC=$(printf '%%s' "$in" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4)
export KIRA_DOC=$(basename "$KIRA_DOC")
"$real" "${args[@]}" <<< "$in" | sed 1d
`

// jsonClaude installs the shim over the harness's claude and returns its directory. A second call
// on the same app returns the same directory.
func jsonClaude(t *testing.T, app *flowharness.App) string {
	t.Helper()
	dir := filepath.Join(app.Root, "shim")
	real := filepath.Join(app.BinDir, "real", "claude")
	if _, err := os.Stat(real); err == nil {
		return dir
	}
	for _, d := range []string{dir, filepath.Dir(real)} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	link := filepath.Join(app.BinDir, "claude")
	self, err := os.Readlink(link)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(self, real); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(link, []byte(fmt.Sprintf(shimScript, real, dir)), 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

// shimFile copies testdata/src into the shim directory as name.
func shimFile(t *testing.T, dir, src, name string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", src))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), raw, 0o644); err != nil {
		t.Fatal(err)
	}
}
