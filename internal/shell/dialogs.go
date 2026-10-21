package shell

import "github.com/kirathecat/kira-studio/internal/ipcerr"

// ChooseFolder runs a native folder-picker dialog and normalises its result — both apps' own
// bridge.FilesService.ChooseFolder. open is each app's own bound Dialogs.
// OpenDirectory, closed over its own OpenDirectoryRequest wire type (a distinct type per app,
// so this package takes a plain func rather than an interface parameter). Every
// method returns "" for a cancelled dialog, the only cancel signal Wails gives:
// ("", false, err) on failure, ("", true, nil) when cancelled, else (path, false, nil).
func ChooseFolder(open func(title string) (string, error), title string) (path string, canceled bool, err error) {
	path, err = open(title)
	if err != nil {
		return "", false, ipcerr.Internal(err.Error())
	}
	if path == "" {
		return "", true, nil
	}
	return path, false, nil
}
