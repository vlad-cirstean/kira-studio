package ipcfixture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// committedJSONFixture is one adapter's testdata/<adapter>.fixture.json: a JSON transcription of
// the committed tests/ipc/<adapter>/<adapter>.fixture.ts, produced once via `bun run` and never
// hand-edited — the TypeScript file stays authoritative; this is a fast-loop-friendly copy of it
// so a TestFixture_* needs no Node at all to run (§4.2: "no GTK/WebKit headers").
type committedJSONFixture struct {
	ControlSnapshots []ControlSnapshot `json:"controlSnapshots"`
	PortSnapshots    []PortSnapshot    `json:"portSnapshots"`
}

func loadCommittedJSONFixture(t *testing.T, path string) committedJSONFixture {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ipcfixture: read committed fixture %s: %v", path, err)
	}
	var fx committedJSONFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("ipcfixture: parse committed fixture %s: %v", path, err)
	}
	return fx
}

// canonicalize round-trips v through json.Marshal/Unmarshal so two structurally-equal values
// compare equal regardless of Go map key ordering or numeric type — the same normalization the
// TypeScript backend spec's own assert-mode applies (JSON.parse(JSON.stringify(...))).
func canonicalize(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("ipcfixture: canonicalize: %v", err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("ipcfixture: canonicalize: %v", err)
	}
	return out
}

// assertMatchesCommittedJSONFixture is every TestFixture_*'s final step (§4.5 step 1/2): the real
// run's captured Control/Port snapshots must match jsonFixturePath's committed content, modulo the
// keyset continuation-token finding (frozen.go's MaskContinuationTokens).
func assertMatchesCommittedJSONFixture(t *testing.T, rec *Recorder, jsonFixturePath string) {
	t.Helper()
	want := loadCommittedJSONFixture(t, jsonFixturePath)

	gotControl := canonicalize(t, rec.Control)
	wantControl := canonicalize(t, want.ControlSnapshots)
	MaskContinuationTokens(gotControl)
	MaskContinuationTokens(wantControl)
	if diff := cmp.Diff(wantControl, gotControl); diff != "" {
		t.Errorf("control snapshots diff from committed fixture %s (-want +got):\n%s", jsonFixturePath, diff)
	}

	gotPort := canonicalize(t, rec.Port)
	wantPort := canonicalize(t, want.PortSnapshots)
	MaskContinuationTokens(gotPort)
	MaskContinuationTokens(wantPort)
	if diff := cmp.Diff(wantPort, gotPort); diff != "" {
		t.Errorf("port snapshots diff from committed fixture %s (-want +got):\n%s", jsonFixturePath, diff)
	}
}

// repoRootForWrite resolves the repository root from this package's own path
// (shell/internal/ipcfixture), the same way every other repo-relative path this package needs
// (write.go's FixturePathFor) is anchored — os.Getwd() during `go test` is always the package
// directory, never the module root.
func repoRootForWrite(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("ipcfixture: getwd: %v", err)
	}
	return filepath.Clean(filepath.Join(wd, "..", "..", ".."))
}

// maybeWriteFixture is P58f §4.5 step 3/D15's write-mode branch, the Go analogue of every
// backend.spec.ts's own `if (isFixtureWriteMode()) { writeFixtureModule(...); return; }` — when
// KIRA_IPC_FIXTURES=write, this writes rec's own captured (and already adapter-frozen, per
// frozen.go) snapshots straight to the real tests/ipc/<adapterName>/<adapterName>.fixture.ts,
// exactly as the TypeScript generator this package replaces did, and reports true so the caller
// skips the read-mode assertion. Read mode (the default, and every CI run) always returns false.
func maybeWriteFixture(t *testing.T, rec *Recorder, adapterName string) bool {
	t.Helper()
	if !IsWriteMode() {
		return false
	}
	path := FixturePathFor(repoRootForWrite(t), adapterName)
	if err := WriteFixtureModule(path, adapterName, rec.Control, rec.Port); err != nil {
		t.Fatalf("ipcfixture: write fixture %s: %v", adapterName, err)
	}
	t.Logf("ipcfixture: wrote %s (KIRA_IPC_FIXTURES=write)", path)
	return true
}
