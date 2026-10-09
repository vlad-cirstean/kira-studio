package appflow_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
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
