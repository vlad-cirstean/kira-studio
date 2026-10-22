package appflow_test

import (
	"errors"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

func TestUpdateRefusedInDevBuild(t *testing.T) {
	app := flowharness.New(t)
	st, err := app.W.Update.Status(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if st.UpdateAvailable {
		t.Fatalf("dev build reports an update: %+v", st)
	}
	if err := app.W.Update.InstallUpdate(ctx); err == nil {
		t.Fatal("InstallUpdate succeeded in a dev build")
	}
	if err := app.W.Update.CancelInstall(); err != nil {
		t.Fatalf("CancelInstall with nothing installing: %v", err)
	}
}

func TestCheckForUpdatesRefusedInDevBuild(t *testing.T) {
	app := flowharness.New(t)
	var ie *ipcerr.Error
	if _, err := app.W.Update.Check(ctx); !errors.As(err, &ie) || ie.Code != "E_CONFLICT" || ie.Message != "Updates are available only in release builds." {
		t.Fatalf("Check in a dev build = %v, want the coded notRelease error", err)
	}
}
