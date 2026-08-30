package bridge_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
)

// recordingDialogs implements bridge.Dialogs, recording every request and answering with a
// pre-set result.
type recordingDialogs struct {
	saveReq bridge.SaveFileRequest
	saveRes string
	saveErr error

	openReq bridge.OpenFileRequest
	openRes string
	openErr error
}

func (d *recordingDialogs) SaveFile(req bridge.SaveFileRequest) (string, error) {
	d.saveReq = req
	return d.saveRes, d.saveErr
}

func (d *recordingDialogs) OpenFile(req bridge.OpenFileRequest) (string, error) {
	d.openReq = req
	return d.openRes, d.openErr
}

func TestChooseSaveBasenameGuard(t *testing.T) {
	d := &recordingDialogs{saveRes: "/whatever"}
	svc := &bridge.FilesService{Dialogs: d}

	if _, err := svc.ChooseSave(bridge.FilesChooseSaveArgs{DefaultName: "a/b/c/key.csv"}); err != nil {
		t.Fatalf("ChooseSave: %v", err)
	}
	if d.saveReq.Filename != "key.csv" {
		t.Errorf("Filename = %q, want key.csv", d.saveReq.Filename)
	}
	home, _ := os.UserHomeDir()
	want := filepath.Join(home, "Downloads")
	if d.saveReq.Directory != want {
		t.Errorf("Directory = %q, want %q", d.saveReq.Directory, want)
	}
}

func TestChooseSaveCancel(t *testing.T) {
	d := &recordingDialogs{saveRes: ""}
	svc := &bridge.FilesService{Dialogs: d}

	got, err := svc.ChooseSave(bridge.FilesChooseSaveArgs{DefaultName: "report.csv"})
	if err != nil {
		t.Fatalf("ChooseSave: %v", err)
	}
	if !got.Canceled || got.FilePath != nil {
		t.Errorf("got %+v, want {Canceled:true FilePath:nil}", got)
	}
}

func TestChooseSaveSuccess(t *testing.T) {
	d := &recordingDialogs{saveRes: "/home/user/Downloads/report.csv"}
	svc := &bridge.FilesService{Dialogs: d}

	got, err := svc.ChooseSave(bridge.FilesChooseSaveArgs{DefaultName: "report.csv"})
	if err != nil {
		t.Fatalf("ChooseSave: %v", err)
	}
	if got.Canceled || got.FilePath == nil || *got.FilePath != d.saveRes {
		t.Errorf("got %+v, want {Canceled:false FilePath:&%q}", got, d.saveRes)
	}
}

func TestChooseSaveEmptyNameRejected(t *testing.T) {
	d := &recordingDialogs{saveRes: "/should-not-be-used"}
	svc := &bridge.FilesService{Dialogs: d}

	_, err := svc.ChooseSave(bridge.FilesChooseSaveArgs{DefaultName: ""})
	if err == nil {
		t.Fatalf("ChooseSave with an empty defaultName: want an error")
	}
	var ie *ipcerr.Error
	if !errors.As(err, &ie) || ie.Code != "E_BAD_REQUEST" {
		t.Fatalf("error = %v, want E_BAD_REQUEST", err)
	}
	if d.saveReq != (bridge.SaveFileRequest{}) {
		t.Errorf("dialog was called: %+v, want no call", d.saveReq)
	}
}

func TestChooseOpenReturnsStat(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.sqlite")
	content := []byte("hello world")
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	d := &recordingDialogs{openRes: path}
	svc := &bridge.FilesService{Dialogs: d}

	got, err := svc.ChooseOpen(bridge.FilesChooseOpenArgs{})
	if err != nil {
		t.Fatalf("ChooseOpen: %v", err)
	}
	if got.Canceled || got.File == nil {
		t.Fatalf("got %+v, want a real file", got)
	}
	if got.File.Path != path || got.File.Name != "data.sqlite" || got.File.Size != int64(len(content)) {
		t.Errorf("File = %+v, want {Path:%q Name:data.sqlite Size:%d}", got.File, path, len(content))
	}
}

func TestChooseOpenCancel(t *testing.T) {
	d := &recordingDialogs{openRes: ""}
	svc := &bridge.FilesService{Dialogs: d}

	got, err := svc.ChooseOpen(bridge.FilesChooseOpenArgs{})
	if err != nil {
		t.Fatalf("ChooseOpen: %v", err)
	}
	if !got.Canceled || got.File != nil {
		t.Errorf("got %+v, want {Canceled:true File:nil}", got)
	}
}

func TestChooseOpenMissingFile(t *testing.T) {
	d := &recordingDialogs{openRes: filepath.Join(t.TempDir(), "does-not-exist.sqlite")}
	svc := &bridge.FilesService{Dialogs: d}

	_, err := svc.ChooseOpen(bridge.FilesChooseOpenArgs{})
	if err == nil {
		t.Fatalf("ChooseOpen with a missing file: want an error")
	}
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	if ie.Code != "E_INTERNAL" {
		t.Errorf("Code = %q, want E_INTERNAL", ie.Code)
	}
}

func TestWailsFilterTranslation(t *testing.T) {
	// wailsFilter is unexported; drive it through ChooseOpen and inspect what reached the dialog.
	tests := []struct {
		name        string
		filters     []bridge.FileFilter
		wantName    string
		wantPattern string
	}{
		{
			name: "ConnectionDialog.vue's real two-filter list collapses to no filter (D8)",
			filters: []bridge.FileFilter{
				{Name: "SQLite database", Extensions: []string{"sqlite", "sqlite3", "db", "db3"}},
				{Name: "All files", Extensions: []string{"*"}},
			},
			wantName: "", wantPattern: "",
		},
		{
			name:        "single group",
			filters:     []bridge.FileFilter{{Name: "SQLite database", Extensions: []string{"sqlite", "sqlite3", "db", "db3"}}},
			wantName:    "SQLite database",
			wantPattern: "*.sqlite;*.sqlite3;*.db;*.db3",
		},
		{
			name: "two groups with no wildcard flatten into one pattern",
			filters: []bridge.FileFilter{
				{Name: "Images", Extensions: []string{"png", "jpg"}},
				{Name: "Text", Extensions: []string{"txt"}},
			},
			wantName:    "Images",
			wantPattern: "*.png;*.jpg;*.txt",
		},
		{
			name: "empty list", filters: nil, wantName: "", wantPattern: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := &recordingDialogs{openRes: ""}
			svc := &bridge.FilesService{Dialogs: d}
			if _, err := svc.ChooseOpen(bridge.FilesChooseOpenArgs{Filters: tt.filters}); err != nil {
				t.Fatalf("ChooseOpen: %v", err)
			}
			if d.openReq.FilterName != tt.wantName || d.openReq.FilterPattern != tt.wantPattern {
				t.Errorf("got (name=%q, pattern=%q), want (name=%q, pattern=%q)",
					d.openReq.FilterName, d.openReq.FilterPattern, tt.wantName, tt.wantPattern)
			}
		})
	}
}
