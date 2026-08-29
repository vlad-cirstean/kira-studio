package bridge_test

import (
	"errors"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/enginetest"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
	"github.com/kirathecat/kira-studio/shell/internal/tree"
)

// fakeConnected is a tree.Connected returning "disconnected" for everything — enough for the
// bridge-level empty-connectionId guard, which never reaches it.
type fakeConnected struct{}

func (fakeConnected) StateOf(connectionID string) model.ConnectionState {
	return model.ConnectionState{ConnectionID: connectionID, Status: "disconnected"}
}

func newTreeService(t *testing.T) *bridge.TreeService {
	t.Helper()
	t.Setenv("KIRA_HOME", t.TempDir())

	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	r, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	host := enginetest.Host(t)
	svc := tree.New(r.Connections, r.Metadata, host, fakeConnected{})
	return &bridge.TreeService{Deps: appcore.Deps{Tree: svc}}
}

func TestTreeServiceChildrenEmptyConnectionID(t *testing.T) {
	s := newTreeService(t)
	_, err := s.Children(bridge.TreeChildrenArgs{ConnectionID: "", Path: "", Refresh: false})
	if err == nil {
		t.Fatalf("Children with an empty connectionId: want an error")
	}
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	if ie.Code != "E_BAD_REQUEST" {
		t.Errorf("Code = %q, want E_BAD_REQUEST", ie.Code)
	}
}
