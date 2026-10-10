package scripts

import "github.com/kirathecat/kira-studio/internal/ipcerr"

// Service holds every method body once. Each app's bridge.CustomScriptsService is a wrapper struct
// with forwarding methods, so Wails builds binding names from the app's own package. Every mutation broadcasts the full snapshot
// through Emit so a second window's Scripts list stays live.
type Service struct {
	Repo *Repo
	Emit func(snapshot Snapshot)
	// Home is the app data folder; removing a script deletes its automations folder under it.
	Home string
	// OnChange runs after every mutation's broadcast (the scheduler reloads).
	OnChange func()
}

func fail(err error) error {
	if IsCallerError(err) {
		return ipcerr.BadRequest(err.Error())
	}
	return ipcerr.InternalErr(err)
}

func (s *Service) snapshot() (Snapshot, error) {
	collections, err := s.Repo.ListCollections()
	if err != nil {
		return Snapshot{}, err
	}
	scripts, err := s.Repo.List()
	if err != nil {
		return Snapshot{}, err
	}
	return Snapshot{Collections: collections, Scripts: scripts}, nil
}

func (s *Service) List() (Snapshot, error) {
	return ipcerr.InternalResult(s.snapshot())
}

func (s *Service) broadcast() {
	snap, err := s.snapshot()
	if err != nil {
		return
	}
	s.Emit(snap)
	if s.OnChange != nil {
		s.OnChange()
	}
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
	if s.Home != "" {
		RemoveDir(s.Home, args.ID)
	}
	s.broadcast()
	return nil
}

type CreateCollectionArgs struct {
	Name string `json:"name"`
}

func (s *Service) CreateCollection(args CreateCollectionArgs) (Collection, error) {
	c, err := s.Repo.CreateCollection(args.Name)
	if err != nil {
		return Collection{}, fail(err)
	}
	s.broadcast()
	return c, nil
}

type RenameCollectionArgs struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *Service) RenameCollection(args RenameCollectionArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Repo.RenameCollection(args.ID, args.Name); err != nil {
		return fail(err)
	}
	s.broadcast()
	return nil
}

type DeleteCollectionArgs struct {
	ID string `json:"id"`
}

func (s *Service) DeleteCollection(args DeleteCollectionArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Repo.DeleteCollection(args.ID); err != nil {
		return fail(err)
	}
	s.broadcast()
	return nil
}

type MoveArgs struct {
	ID           string  `json:"id"`
	CollectionID *string `json:"collectionId"`
}

func (s *Service) Move(args MoveArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Repo.Move(args.ID, args.CollectionID); err != nil {
		return fail(err)
	}
	s.broadcast()
	return nil
}
