package ipcfixture

import (
	"encoding/json"
	"os"
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
