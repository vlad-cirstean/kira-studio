package termflow

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/scripts"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

func TestScriptInPickedFolder(t *testing.T) {
	app := flowharness.New(t)

	canceled, err := app.W.Files.ChooseFolder(bridge.FilesChooseFolderArgs{})
	if err != nil || !canceled.Canceled || canceled.Path != nil {
		t.Fatalf("cancelled picker = %+v, %v, want canceled with no path", canceled, err)
	}

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "marker.txt"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	app.Dialogs.QueueDirectory(dir)
	picked, err := app.W.Files.ChooseFolder(bridge.FilesChooseFolderArgs{Title: "Pick"})
	if err != nil || picked.Canceled || picked.Path == nil || *picked.Path != dir {
		t.Fatalf("picker = %+v, %v, want %s", picked, err, dir)
	}

	mark := app.Events.Mark()
	cmd := "ls marker.txt; exit 4"
	rec, err := app.W.CustomScripts.Create(bridge.CustomScriptsCreateArgs{Fields: scripts.CustomScriptFields{
		Name: "list", Command: cmd, DirMode: scripts.DirModeFixed, WorkingDir: *picked.Path, Color: "blue",
	}})
	if err != nil {
		t.Fatal(err)
	}
	ev := app.Events.WaitAfter(t, mark, bridge.ChannelCustomScriptsChanged, nil, wait)
	var snap scripts.Snapshot
	ev.Decode(t, &snap)
	if len(snap.Scripts) != 1 || snap.Scripts[0].ID != rec.ID || snap.Scripts[0].WorkingDir != dir {
		t.Fatalf("changed snapshot = %+v, want the new command in %s", snap, dir)
	}

	if _, err := app.W.Terminal.Open(terminal.OpenArgs{
		TerminalID: "qc", WindowKey: "w1", Cwd: rec.WorkingDir, Cols: 80, Rows: 24, Command: rec.Command, LaunchKind: terminal.LaunchKindScript,
	}); err != nil {
		t.Fatal(err)
	}
	waitMatch(t, app, mark, "w1", "qc", line("marker.txt"))
	if code := waitExit(t, app, mark, "w1", "qc"); code != 4 {
		t.Fatalf("exit code = %d, want 4", code)
	}
}

func TestScriptCollections(t *testing.T) {
	app := flowharness.New(t)
	cs := app.W.CustomScripts
	fields := func(name string, coll *string) scripts.CustomScriptFields {
		return scripts.CustomScriptFields{Name: name, Command: "echo " + name, Color: "blue", CollectionID: coll}
	}

	a, err := cs.CreateCollection(bridge.CustomScriptsCreateCollectionArgs{Name: "A"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := cs.CreateCollection(bridge.CustomScriptsCreateCollectionArgs{Name: "B"})
	if err != nil {
		t.Fatal(err)
	}
	s1, err := cs.Create(bridge.CustomScriptsCreateArgs{Fields: fields("one", &a.ID)})
	if err != nil {
		t.Fatal(err)
	}
	s2, err := cs.Create(bridge.CustomScriptsCreateArgs{Fields: fields("two", &a.ID)})
	if err != nil {
		t.Fatal(err)
	}

	if err := cs.Move(bridge.CustomScriptsMoveArgs{ID: s1.ID, CollectionID: &b.ID}); err != nil {
		t.Fatal(err)
	}
	if err := cs.Move(bridge.CustomScriptsMoveArgs{ID: s2.ID, CollectionID: nil}); err != nil {
		t.Fatal(err)
	}
	if err := cs.RenameCollection(bridge.CustomScriptsRenameCollectionArgs{ID: b.ID, Name: "Renamed"}); err != nil {
		t.Fatal(err)
	}
	snap := lastSnapshot(t, app)
	byName := map[string]scripts.CustomScript{}
	for _, s := range snap.Scripts {
		byName[s.Name] = s
	}
	if c := byName["one"].CollectionID; c == nil || *c != b.ID {
		t.Fatalf("one in %v, want collection B", c)
	}
	if byName["two"].CollectionID != nil {
		t.Fatalf("two in %v, want ungrouped", *byName["two"].CollectionID)
	}
	renamed := false
	for _, c := range snap.Collections {
		renamed = renamed || (c.ID == b.ID && c.Name == "Renamed")
	}
	if !renamed {
		t.Fatalf("collections = %+v, want B renamed", snap.Collections)
	}

	if err := cs.DeleteCollection(bridge.CustomScriptsDeleteCollectionArgs{ID: b.ID}); err != nil {
		t.Fatal(err)
	}
	listed, err := cs.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Scripts) != 1 || listed.Scripts[0].ID != s2.ID || len(listed.Collections) != 1 {
		t.Fatalf("after delete = %+v, want only the ungrouped command and collection A", listed)
	}
	if got := lastSnapshot(t, app); !sameJSON(got, listed) {
		t.Fatalf("event snapshot %+v differs from List %+v", got, listed)
	}

	app.Restart(t)
	again, err := app.W.CustomScripts.List()
	if err != nil {
		t.Fatal(err)
	}
	if !sameJSON(again, listed) {
		t.Fatalf("after Restart = %+v, want %+v", again, listed)
	}
}

func lastSnapshot(t *testing.T, app *flowharness.App) scripts.Snapshot {
	t.Helper()
	evs := app.Events.Since(0, bridge.ChannelCustomScriptsChanged)
	if len(evs) == 0 {
		t.Fatal("no customScripts:changed event")
	}
	var snap scripts.Snapshot
	evs[len(evs)-1].Decode(t, &snap)
	return snap
}

func sameJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return bytes.Equal(x, y)
}

func TestCustomScriptUpdateRemove(t *testing.T) {
	app := flowharness.New(t)
	cs := app.W.CustomScripts
	rec, err := cs.Create(bridge.CustomScriptsCreateArgs{Fields: scripts.CustomScriptFields{Name: "old", Command: "echo old", Color: "blue"}})
	if err != nil {
		t.Fatal(err)
	}
	keep, err := cs.Create(bridge.CustomScriptsCreateArgs{Fields: scripts.CustomScriptFields{Name: "keep", Command: "echo keep", Color: "green"}})
	if err != nil {
		t.Fatal(err)
	}

	mark := app.Events.Mark()
	dir := t.TempDir()
	upd, err := cs.Update(bridge.CustomScriptsUpdateArgs{ID: rec.ID, Fields: scripts.CustomScriptFields{
		Name: "new", Command: "echo new; exit 3", DirMode: scripts.DirModeFixed, WorkingDir: dir, Color: "red",
	}})
	if err != nil || upd.Name != "new" || upd.Command != "echo new; exit 3" || upd.WorkingDir != dir || upd.Color != "red" {
		t.Fatalf("Update = %+v (%v)", upd, err)
	}
	app.Events.WaitAfter(t, mark, bridge.ChannelCustomScriptsChanged, nil, wait)

	// The updated command is what a terminal now runs.
	if _, err := app.W.Terminal.Open(terminal.OpenArgs{
		TerminalID: "upd", WindowKey: "w1", Cwd: upd.WorkingDir, Cols: 80, Rows: 24, Command: upd.Command, LaunchKind: terminal.LaunchKindScript,
	}); err != nil {
		t.Fatal(err)
	}
	waitMatch(t, app, mark, "w1", "upd", line("new"))
	if code := waitExit(t, app, mark, "w1", "upd"); code != 3 {
		t.Fatalf("exit code = %d, want 3", code)
	}

	if _, err := cs.Update(bridge.CustomScriptsUpdateArgs{ID: "missing", Fields: scripts.CustomScriptFields{Name: "x", Command: "x", Color: "blue"}}); err == nil {
		t.Fatal("Update of an unknown command succeeded")
	}
	if _, err := cs.Update(bridge.CustomScriptsUpdateArgs{ID: rec.ID, Fields: scripts.CustomScriptFields{Name: "", Command: "x", Color: "blue"}}); err == nil {
		t.Fatal("Update with an empty name succeeded")
	}

	mark = app.Events.Mark()
	if err := cs.Remove(bridge.CustomScriptsRemoveArgs{ID: rec.ID}); err != nil {
		t.Fatal(err)
	}
	var snap scripts.Snapshot
	app.Events.WaitAfter(t, mark, bridge.ChannelCustomScriptsChanged, nil, wait).Decode(t, &snap)
	if len(snap.Scripts) != 1 || snap.Scripts[0].ID != keep.ID {
		t.Fatalf("snapshot after Remove = %+v, want only %q", snap, keep.Name)
	}
	if err := cs.Remove(bridge.CustomScriptsRemoveArgs{ID: rec.ID}); err == nil {
		t.Fatal("removing an already removed command succeeded")
	}

	app.Restart(t)
	again, err := app.W.CustomScripts.List()
	if err != nil || len(again.Scripts) != 1 || again.Scripts[0].ID != keep.ID {
		t.Fatalf("after Restart = %+v (%v)", again, err)
	}
}
