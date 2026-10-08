package bridge

import (
	"os"
	"path/filepath"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
)

const (
	maxImportPaths = 100
	// importFilter is the native picker's file filter: the extensions the importer reads.
	importFilter = "*.md;*.markdown;*.mdx;*.txt;*.text;*.rst;*.adoc"
)

// MemoryImportService is the Memory module's bulk document import. A separate bound service from
// MemoryService so the import surface stays one concern; both share one memory.db and engine.
type MemoryImportService struct {
	mem     *MemoryService
	dialogs Dialogs
}

func NewMemoryImportService(mem *MemoryService, dialogs Dialogs) *MemoryImportService {
	return &MemoryImportService{mem: mem, dialogs: dialogs}
}

// MemoryImportChooseArgs picks the dialog: "files" (several documents) or "folder".
type MemoryImportChooseArgs struct {
	Kind string `json:"kind"`
}

type MemoryImportChoice struct {
	Canceled bool     `json:"canceled"`
	Paths    []string `json:"paths"`
}

type MemoryImportCreateArgs struct {
	Paths []string `json:"paths"`
}

type MemoryImportJobArgs struct {
	ID string `json:"id"`
}

type MemoryImportFileArgs struct {
	FileID string `json:"fileId"`
}

// Choose opens the native picker.
func (s *MemoryImportService) Choose(args MemoryImportChooseArgs) (MemoryImportChoice, error) {
	var paths []string
	switch args.Kind {
	case "files":
		picked, err := s.dialogs.OpenFiles(OpenFilesRequest{Title: "Import documents", FilterName: "Documents", FilterPattern: importFilter})
		if err != nil {
			return MemoryImportChoice{}, ipcerr.Internal(err.Error())
		}
		paths = picked
	case "folder":
		dir, err := s.dialogs.OpenDirectory(OpenDirectoryRequest{Title: "Import folder"})
		if err != nil {
			return MemoryImportChoice{}, ipcerr.Internal(err.Error())
		}
		if dir != "" {
			paths = []string{dir}
		}
	default:
		return MemoryImportChoice{}, ipcerr.BadRequest("kind must be files or folder")
	}
	if len(paths) == 0 {
		return MemoryImportChoice{Canceled: true, Paths: []string{}}, nil
	}
	return MemoryImportChoice{Paths: paths}, nil
}

// Create scans the paths in the background. The returned job is scanning; wait for awaiting.
func (s *MemoryImportService) Create(args MemoryImportCreateArgs) (importer.Job, error) {
	if n := len(args.Paths); n < 1 || n > maxImportPaths {
		return importer.Job{}, ipcerr.BadRequest("pick 1 to 100 files or folders")
	}
	for _, p := range args.Paths {
		if !filepath.IsAbs(p) {
			return importer.Job{}, ipcerr.BadRequest("paths must be absolute")
		}
		if _, err := os.Stat(p); err != nil {
			return importer.Job{}, ipcerr.BadRequest("cannot read " + p)
		}
	}
	e, err := s.mem.importer()
	if err != nil {
		return importer.Job{}, memoryErr(err)
	}
	job, err := e.Create(args.Paths)
	return job, memoryErr(err)
}

// Jobs lists imports that are not dismissed, newest first.
func (s *MemoryImportService) Jobs() ([]importer.Job, error) {
	e, err := s.mem.importer()
	if err != nil {
		return nil, memoryErr(err)
	}
	jobs, err := e.Jobs()
	return jobs, memoryErr(err)
}

// Job returns one import with its files.
func (s *MemoryImportService) Job(args MemoryImportJobArgs) (importer.JobDetail, error) {
	e, err := s.mem.importer()
	if err != nil {
		return importer.JobDetail{}, memoryErr(err)
	}
	d, err := e.Job(args.ID)
	return d, memoryErr(err)
}

func (s *MemoryImportService) act(id string, do func(*importer.Engine, string) error) error {
	e, err := s.mem.importer()
	if err != nil {
		return memoryErr(err)
	}
	return memoryErr(do(e, id))
}

func (s *MemoryImportService) Start(args MemoryImportJobArgs) error {
	return s.act(args.ID, (*importer.Engine).Start)
}

func (s *MemoryImportService) Pause(args MemoryImportJobArgs) error {
	return s.act(args.ID, (*importer.Engine).Pause)
}

func (s *MemoryImportService) Resume(args MemoryImportJobArgs) error {
	return s.act(args.ID, (*importer.Engine).Resume)
}

func (s *MemoryImportService) Cancel(args MemoryImportJobArgs) error {
	return s.act(args.ID, (*importer.Engine).Cancel)
}

func (s *MemoryImportService) Discard(args MemoryImportJobArgs) error {
	return s.act(args.ID, (*importer.Engine).Discard)
}

func (s *MemoryImportService) Dismiss(args MemoryImportJobArgs) error {
	return s.act(args.ID, (*importer.Engine).Dismiss)
}

func (s *MemoryImportService) RetryFailed(args MemoryImportJobArgs) error {
	return s.act(args.ID, (*importer.Engine).RetryFailed)
}

func (s *MemoryImportService) RetryFile(args MemoryImportFileArgs) error {
	return s.act(args.FileID, (*importer.Engine).RetryFile)
}
