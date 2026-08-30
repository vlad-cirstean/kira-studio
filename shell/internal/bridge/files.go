package bridge

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
)

// The four wire shapes, byte for byte src/shared/protocol/ipc.ts:133-149's.
type FilesChooseSaveArgs struct {
	DefaultName string `json:"defaultName"`
}
type FilesChooseSaveResult struct {
	Canceled bool    `json:"canceled"`
	FilePath *string `json:"filePath"`
}

type FileFilter struct {
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
}
type FilesChooseOpenArgs struct {
	Filters []FileFilter `json:"filters,omitempty"`
	Title   string       `json:"title,omitempty"`
}
type ChosenFile struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}
type FilesChooseOpenResult struct {
	Canceled bool        `json:"canceled"`
	File     *ChosenFile `json:"file"`
}

// SaveFileRequest / OpenFileRequest are the platform-neutral asks. FilterPattern is already in
// Wails' own "*.a;*.b" form (dialogs.go:279's AddFilter doc); an empty FilterName means "no
// filter", which is how D8's `*` case is expressed.
type SaveFileRequest struct{ Directory, Filename string }
type OpenFileRequest struct{ Title, FilterName, FilterPattern string }

// Dialogs is the native-dialog seam. internal/shell implements it over app.Dialog with the main
// window attached for modality; files_test.go implements it with a recorder. Both methods return
// "" for a cancelled dialog, which is the only cancel signal Wails gives (P56 §1.2).
type Dialogs interface {
	SaveFile(req SaveFileRequest) (string, error)
	OpenFile(req OpenFileRequest) (string, error)
}

type FilesService struct {
	Dialogs Dialogs
}

// ChooseSave ports src/main/ipc/files.ts:26-36. filepath.Base, not the suggested name verbatim —
// an S3 key routinely contains '/', which the save panel would otherwise read as a subdirectory
// path (P56 D9, and files.ts:29-30's own comment).
func (s *FilesService) ChooseSave(args FilesChooseSaveArgs) (FilesChooseSaveResult, error) {
	if args.DefaultName == "" {
		return FilesChooseSaveResult{}, ipcerr.BadRequest("defaultName is required")
	}
	path, err := s.Dialogs.SaveFile(SaveFileRequest{
		Directory: downloadsDir(),
		Filename:  filepath.Base(args.DefaultName),
	})
	if err != nil {
		return FilesChooseSaveResult{}, ipcerr.Internal(err.Error())
	}
	if path == "" {
		return FilesChooseSaveResult{Canceled: true}, nil
	}
	return FilesChooseSaveResult{Canceled: false, FilePath: &path}, nil
}

// ChooseOpen ports files.ts:38-53, including the stat() that fills `size`.
func (s *FilesService) ChooseOpen(args FilesChooseOpenArgs) (FilesChooseOpenResult, error) {
	req := OpenFileRequest{Title: args.Title}
	if name, pattern, ok := wailsFilter(args.Filters); ok {
		req.FilterName, req.FilterPattern = name, pattern
	}

	path, err := s.Dialogs.OpenFile(req)
	if err != nil {
		return FilesChooseOpenResult{}, ipcerr.Internal(err.Error())
	}
	if path == "" {
		return FilesChooseOpenResult{Canceled: true}, nil
	}

	info, err := os.Stat(path)
	if err != nil {
		return FilesChooseOpenResult{}, ipcerr.Internal(fmt.Sprintf("could not stat %s: %s", path, err))
	}
	return FilesChooseOpenResult{
		Canceled: false,
		File:     &ChosenFile{Path: path, Name: filepath.Base(path), Size: info.Size()},
	}, nil
}

// wailsFilter collapses Electron's per-group filter list into the single extension set Wails'
// macOS open panel actually applies (dialogs_darwin.go's show() joins every filter's components
// into one ';' string). Returns ok == false when any extension is "*": Wails has no wildcard —
// panel:shouldEnableURL: matches on a literal ".<ext>" suffix (dialogs_darwin_delegate.m:29-37) —
// and an empty allowed-extension list is what actually means "all files" there (P56 D8).
func wailsFilter(filters []FileFilter) (name, pattern string, ok bool) {
	if len(filters) == 0 {
		return "", "", false
	}
	var patterns []string
	for _, f := range filters {
		for _, ext := range f.Extensions {
			if ext == "*" {
				return "", "", false
			}
			patterns = append(patterns, "*."+ext)
		}
	}
	if len(patterns) == 0 {
		return "", "", false
	}
	return filters[0].Name, strings.Join(patterns, ";"), true
}

// downloadsDir is app.getPath('downloads')'s substitute; Wails' EnvironmentManager exposes no
// path API at all (environment_manager.go:23-58).
func downloadsDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, "Downloads")
}
