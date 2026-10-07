package quickcommands

import "github.com/kirathecat/kira-studio/internal/ipcerr"

// Service is the shared bound type: each app's bridge.CustomScriptsService is
// `struct{ *quickcommands.Service }`, so Wails builds binding names from the registered type's
// own package while every method body lives here once. Every mutation broadcasts the full list
// through Emit so a second window's Quick commands list stays live.
type Service struct {
	Repo *Repo
	Emit func(rows []CustomScript)
}

func fail(err error) error {
	if IsCallerError(err) {
		return ipcerr.BadRequest(err.Error())
	}
	return ipcerr.InternalErr(err)
}

func (s *Service) List() ([]CustomScript, error) {
	return ipcerr.InternalResult(s.Repo.List())
}

func (s *Service) broadcast() {
	rows, err := s.Repo.List()
	if err != nil {
		return
	}
	s.Emit(rows)
}

type CreateArgs struct {
	Fields CustomScriptFields `json:"fields"`
}

func (s *Service) Create(args CreateArgs) (CustomScript, error) {
	rec, err := s.Repo.Create(args.Fields)
	if err != nil {
		return CustomScript{}, fail(err)
	}
	s.broadcast()
	return rec, nil
}

type UpdateArgs struct {
	ID     string             `json:"id"`
	Fields CustomScriptFields `json:"fields"`
}

func (s *Service) Update(args UpdateArgs) (CustomScript, error) {
	if args.ID == "" {
		return CustomScript{}, ipcerr.BadRequest("id is required")
	}
	rec, err := s.Repo.Update(args.ID, args.Fields)
	if err != nil {
		return CustomScript{}, fail(err)
	}
	s.broadcast()
	return rec, nil
}

type RemoveArgs struct {
	ID string `json:"id"`
}

func (s *Service) Remove(args RemoveArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Repo.Remove(args.ID); err != nil {
		return fail(err)
	}
	s.broadcast()
	return nil
}
