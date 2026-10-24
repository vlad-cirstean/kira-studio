package appflow_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/filehandlers"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func handlerStatus(t *testing.T, app *flowharness.App) filehandlers.StatusResult {
	t.Helper()
	res, err := app.W.FileHandlersSvc.Status()
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	return res
}

func stateOf(res filehandlers.StatusResult, ext string) filehandlers.ExtStatus {
	for _, g := range res.Groups {
		for _, e := range g.Extensions {
			if e.Ext == ext {
				return e
			}
		}
	}
	return filehandlers.ExtStatus{}
}

func TestFileHandlersSetAndRestore(t *testing.T) {
	editor := filehandlers.App{Path: "/Applications/Example Editor.app", BundleID: "com.example.Editor", Name: "Example Editor"}
	fake := flowharness.NewFakeHandlers()
	fake.Install(editor)
	fake.Declare("json", editor)
	fake.Declare("yaml", editor)
	fake.Declare("go", filehandlers.App{})
	app := flowharness.New(t, flowharness.WithFileHandlers(fake))

	before := handlerStatus(t, app)
	app.Contract(t, "file-handlers", "FileHandlersService.Status#before", before)
	if !before.Supported {
		t.Fatal("Supported = false, want true")
	}
	if e := stateOf(before, "json"); e.State != filehandlers.StateOther || e.Handler == nil || e.Handler.BundleID != "com.example.Editor" {
		t.Fatalf("json = %+v, want other, Example Editor", e)
	}
	if e := stateOf(before, "toml"); e.State != filehandlers.StateUnavailable {
		t.Fatalf("toml = %+v, want unavailable", e)
	}
	if e := stateOf(before, "go"); e.State != filehandlers.StateNone {
		t.Fatalf("go = %+v, want none", e)
	}

	if _, err := app.W.FileHandlersSvc.Set(filehandlers.SetArgs{Exts: []string{"json", "yaml", "go"}, On: true}); err != nil {
		t.Fatalf("Set on: %v", err)
	}
	on := handlerStatus(t, app)
	app.Contract(t, "file-handlers", "FileHandlersService.Status#on", on)
	for _, ext := range []string{"json", "yaml", "go"} {
		if e := stateOf(on, ext); e.State != filehandlers.StateSelf {
			t.Fatalf("%s = %+v, want self", ext, e)
		}
	}
	res, err := app.W.FileHandlersSvc.Set(filehandlers.SetArgs{Exts: []string{"json"}, On: false})
	if err != nil || len(res.Unrestored) != 0 {
		t.Fatalf("Set off json = %+v, %v", res, err)
	}
	if got := fake.HandlerOf("json"); got != editor {
		t.Fatalf("json handler = %+v, want Example Editor", got)
	}
	res, err = app.W.FileHandlersSvc.Set(filehandlers.SetArgs{Exts: []string{"go"}, On: false})
	if err != nil || !reflect.DeepEqual(res.Unrestored, []string{"go"}) {
		t.Fatalf("Set off go = %+v, %v, want unrestored [go] (nothing saved)", res, err)
	}
	app.Contract(t, "file-handlers", "FileHandlersService.Status#off", handlerStatus(t, app))

	fake.Uninstall(editor)
	res, err = app.W.FileHandlersSvc.Set(filehandlers.SetArgs{Exts: []string{"yaml"}, On: false})
	if err != nil {
		t.Fatalf("Set off yaml: %v", err)
	}
	app.Contract(t, "file-handlers", "FileHandlersService.Set#unrestored", res)
	if !reflect.DeepEqual(res.Unrestored, []string{"yaml"}) {
		t.Fatalf("Unrestored = %v, want [yaml]", res.Unrestored)
	}
	if e := stateOf(handlerStatus(t, app), "yaml"); e.State != filehandlers.StateSelf {
		t.Fatalf("yaml = %+v, want still self", e)
	}
	// The saved row survived the failure: reinstalling the app lets a retry restore it.
	fake.Install(editor)
	res, err = app.W.FileHandlersSvc.Set(filehandlers.SetArgs{Exts: []string{"yaml"}, On: false})
	if err != nil || len(res.Unrestored) != 0 || fake.HandlerOf("yaml") != editor {
		t.Fatalf("retry off yaml = %+v, %v, handler %+v", res, err, fake.HandlerOf("yaml"))
	}

	if _, err := app.W.FileHandlersSvc.Set(filehandlers.SetArgs{Exts: []string{"nope"}, On: true}); err == nil {
		t.Fatal("unknown extension accepted")
	}
}

func TestFileHandlersUnsupportedByDefault(t *testing.T) {
	app := flowharness.New(t)
	res, err := app.W.FileHandlersSvc.Status()
	if err != nil || res.Supported || len(res.Groups) != 0 {
		t.Fatalf("Status = %+v, %v, want unsupported and empty", res, err)
	}
	app.Contract(t, "file-handlers", "FileHandlersService.Status#unsupported", res)
	if _, err := app.W.FileHandlersSvc.Set(filehandlers.SetArgs{Exts: []string{"json"}, On: true}); err == nil {
		t.Fatal("Set succeeded on an unsupported build")
	}
}

func TestFileHandlersSharedTypeRestoresFromSibling(t *testing.T) {
	editor := filehandlers.App{Path: "/Applications/Example Editor.app", BundleID: "com.example.Editor", Name: "Example Editor"}
	fake := flowharness.NewFakeHandlers()
	fake.Install(editor)
	fake.Share("yml", "yaml")
	fake.Declare("yaml", editor)
	fake.Declare("yml", filehandlers.App{})
	app := flowharness.New(t, flowharness.WithFileHandlers(fake))

	if _, err := app.W.FileHandlersSvc.Set(filehandlers.SetArgs{Exts: []string{"yml"}, On: true}); err != nil {
		t.Fatalf("Set on yml: %v", err)
	}
	if e := stateOf(handlerStatus(t, app), "yaml"); e.State != filehandlers.StateSelf {
		t.Fatalf("yaml = %+v, want self through the shared type", e)
	}
	res, err := app.W.FileHandlersSvc.Set(filehandlers.SetArgs{Exts: []string{"yaml"}, On: false})
	if err != nil || len(res.Unrestored) != 0 || fake.HandlerOf("yaml") != editor {
		t.Fatalf("off yaml = %+v, %v, handler %+v, want restored from yml's row", res, err, fake.HandlerOf("yaml"))
	}
}
