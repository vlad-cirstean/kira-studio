package bridge_test

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
)

func TestOpsCancelCallsEngine(t *testing.T) {
	deps, _, host := newTestDepsWithHost(t)
	svc := &bridge.OpsService{Deps: deps}

	if err := svc.Cancel(bridge.OpsCancelArgs{OpID: "op-1"}); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	payload, err := host.Call("fixture:request-count", map[string]any{"op": "adapter:cancel"})
	if err != nil {
		t.Fatalf("fixture:request-count: %v", err)
	}
	var got struct {
		Count int `json:"count"`
	}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Count != 1 {
		t.Errorf("adapter:cancel called %d times, want exactly 1", got.Count)
	}

	countBefore := got.Count
	if err := svc.Cancel(bridge.OpsCancelArgs{OpID: ""}); err == nil {
		t.Fatalf("Cancel with an empty opId: want an error")
	} else {
		var ie *ipcerr.Error
		if !errors.As(err, &ie) || ie.Code != "E_BAD_REQUEST" {
			t.Fatalf("error = %v, want E_BAD_REQUEST", err)
		}
	}
	payload, err = host.Call("fixture:request-count", map[string]any{"op": "adapter:cancel"})
	if err != nil {
		t.Fatalf("fixture:request-count: %v", err)
	}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Count != countBefore {
		t.Errorf("adapter:cancel was called for an empty opId: count went from %d to %d", countBefore, got.Count)
	}
}

func TestOpsCancelSurfacesEngineDown(t *testing.T) {
	deps, _, host := newTestDepsWithHost(t)
	svc := &bridge.OpsService{Deps: deps}

	_, _ = host.Call("fixture:crash", nil) // never answers; the engine process exits instead

	err := svc.Cancel(bridge.OpsCancelArgs{OpID: "op-1"})
	if err == nil {
		t.Fatalf("Cancel after engine crash: want an error")
	}
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	if ie.Code != "E_ENGINE_DOWN" {
		t.Errorf("Code = %q, want E_ENGINE_DOWN", ie.Code)
	}
}
