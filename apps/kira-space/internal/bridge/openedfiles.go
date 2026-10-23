package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/codeworkspace"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/openedfiles"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// OpenedFilesService is the page's side of an external open: it pulls the files its window was
// opened for and reads standalone ones. Open and Add stay off the bound surface.
type OpenedFilesService struct {
	Files *openedfiles.Service
}

type OpenedFilesPendingArgs struct {
	WindowKey string `json:"windowKey"`
}

type OpenedFilesReadArgs struct {
	Path string `json:"path"`
}

// Pending returns the files windowKey was opened for, once.
func (s *OpenedFilesService) Pending(args OpenedFilesPendingArgs) ([]openedfiles.Target, error) {
	if args.WindowKey == "" {
		return nil, ipcerr.Required("windowKey")
	}
	if t := s.Files.Pending(args.WindowKey); t != nil {
		return t, nil
	}
	return []openedfiles.Target{}, nil
}

// Read reads one standalone file.
func (s *OpenedFilesService) Read(args OpenedFilesReadArgs) (codeworkspace.FileContent, error) {
	if args.Path == "" {
		return codeworkspace.FileContent{}, ipcerr.Required("path")
	}
	content, err := s.Files.Read(args.Path)
	if err != nil {
		return codeworkspace.FileContent{}, ipcerr.Contract("%s", err.Error())
	}
	return content, nil
}
