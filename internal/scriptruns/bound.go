package scriptruns

import (
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/scripts"
)

// Bound is the Wails-bound half; each app's bridge.ScriptRunsService embeds it, so binding names
// stay app-local. It forwards to Service and maps errors to the wire.
type Bound struct{ Svc *Service }

type ListArgs struct {
	Limit int `json:"limit"`
}

type IDArgs struct {
	ID string `json:"id"`
}

func (b *Bound) List(args ListArgs) ([]Run, error) {
	return ipcerr.InternalResult(b.Svc.List(args.Limit))
}

func (b *Bound) Get(args IDArgs) (Run, error) {
	if args.ID == "" {
		return Run{}, ipcerr.BadRequest("id is required")
	}
	run, err := b.Svc.Get(args.ID)
	if IsCallerError(err) {
		return Run{}, ipcerr.NotFound("run not found")
	}
	if err != nil {
		return Run{}, ipcerr.InternalErr(err)
	}
	return run, nil
}

func (b *Bound) Stop(args IDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	err := b.Svc.Stop(args.ID)
	if IsCallerError(err) {
		return ipcerr.NotFound("run not found")
	}
	if err != nil {
		return ipcerr.InternalErr(err)
	}
	return nil
}

// ResolveDir previews a script's folder; an empty ScriptID answers the app home.
func (b *Bound) ResolveDir(args ResolveDirArgs) (scripts.Dir, error) {
	dir, err := b.Svc.ResolveDir(args.ScriptID)
	if IsCallerError(err) {
		return scripts.Dir{}, ipcerr.NotFound("script not found")
	}
	if err != nil {
		return scripts.Dir{}, ipcerr.InternalErr(err)
	}
	return dir, nil
}

type ResolveDirArgs struct {
	ScriptID string `json:"scriptId"`
}
