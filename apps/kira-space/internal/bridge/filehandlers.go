package bridge

import (
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/filehandlers"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// FileHandlersService backs the File types pane: which app opens Kira Space's file types, and the
// switch that makes Kira Space the default.
type FileHandlersService struct {
	Handlers *filehandlers.Service
}

// Status reads the live handler of every associated extension.
func (s *FileHandlersService) Status() (filehandlers.StatusResult, error) {
	res, err := s.Handlers.Status()
	if err != nil {
		return filehandlers.StatusResult{}, ipcerr.Internal(err.Error())
	}
	return res, nil
}

// Set makes Kira Space (On) or the previous app (off) the default for Exts.
func (s *FileHandlersService) Set(args filehandlers.SetArgs) (filehandlers.SetResult, error) {
	res, err := s.Handlers.Set(args)
	if err != nil {
		if errors.Is(err, filehandlers.ErrUnsupported) {
			return filehandlers.SetResult{}, ipcerr.Contract("%s", err.Error())
		}
		return filehandlers.SetResult{}, ipcerr.Internal(err.Error())
	}
	return res, nil
}
