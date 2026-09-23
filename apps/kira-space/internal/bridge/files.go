package bridge

import "github.com/kirathecat/kira-studio/internal/shell"

// P100 Part 2: the one file-dialog wire shape this app needs — GitStart.vue's "Import a
// repository" affordance (frontend state/coderepos.ts's importRepoViaDialog). Kira Studio's own
// FilesService also has ChooseSave/ChooseOpen (a download's save panel, an open-file picker for a
// DataGrip project) — this app has neither a download/export feature nor a DataGrip import, so
// this is trimmed to the one method actually called (CLAUDE.md: "scope left out of a phase stays
// out entirely" — ChooseSave/ChooseOpen would be unused, untestable dead code here). This is the
// FilesService shell/app.go's own doc comment flagged as "Part 2's job, if this app ever needs
// it" — it does.
type FilesChooseFolderArgs struct {
	Title string `json:"title,omitempty"`
}
type FilesChooseFolderResult struct {
	Canceled bool    `json:"canceled"`
	Path     *string `json:"path"`
}

// OpenDirectoryRequest is the platform-neutral ask — Kira Studio's own bridge.OpenDirectoryRequest.
type OpenDirectoryRequest struct{ Title string }

// Dialogs is the native-dialog seam — internal/appshell adapts it over repo-root
// internal/shell.Dialogs (app.Dialog with the main window attached for modality, P103 Part 3;
// Kira Studio's own bridge.Dialogs interface, trimmed to the one method this app calls). Returns
// "" for a cancelled dialog, the only cancel signal Wails gives.
type Dialogs interface {
	OpenDirectory(req OpenDirectoryRequest) (string, error)
}

type FilesService struct {
	Dialogs Dialogs
}

// ChooseFolder is Kira Studio's own FilesService.ChooseFolder, ported unchanged.
func (s *FilesService) ChooseFolder(args FilesChooseFolderArgs) (FilesChooseFolderResult, error) {
	path, canceled, err := shell.ChooseFolder(func(title string) (string, error) {
		return s.Dialogs.OpenDirectory(OpenDirectoryRequest{Title: title})
	}, args.Title)
	if err != nil {
		return FilesChooseFolderResult{}, err
	}
	if canceled {
		return FilesChooseFolderResult{Canceled: true}, nil
	}
	return FilesChooseFolderResult{Canceled: false, Path: &path}, nil
}
