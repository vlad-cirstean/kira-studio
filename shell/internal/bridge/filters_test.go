package bridge_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func TestFiltersReplaceRoundTrip(t *testing.T) {
	deps, r, _ := newTestDeps(t)
	seedConnectionRow(t, r, "c1")
	svc := &bridge.FiltersService{Deps: deps}

	vis := model.TreeVisibility{HiddenKinds: []string{"column"}, HiddenPaths: []string{"table:secret"}}
	replaced, err := svc.Replace(bridge.FiltersReplaceArgs{ConnectionID: "c1", Visibility: vis})
	if err != nil {
		t.Fatalf("Replace: %v", err)
	}

	got, err := svc.List(bridge.FiltersListArgs{ConnectionID: "c1"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if diff := cmp.Diff(replaced, got); diff != "" {
		t.Errorf("List() differs from Replace()'s own return (-Replace +List):\n%s", diff)
	}

	_, err = svc.Replace(bridge.FiltersReplaceArgs{ConnectionID: "", Visibility: vis})
	if err == nil {
		t.Fatalf("Replace with an empty connectionId: want an error")
	}
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	if ie.Code != "E_BAD_REQUEST" || ie.Message != "connectionId is required" {
		t.Errorf("error = %+v, want E_BAD_REQUEST \"connectionId is required\"", ie)
	}
}
