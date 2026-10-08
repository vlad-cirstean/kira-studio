package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/quickcommands"
)

// CustomScriptsService is this app's binding-name shim over internal/quickcommands.Service (the
// store, validation and the list-changed broadcast live there once, shared with the other app).
// It reaches s.Deps.Repos.CustomScripts directly, so main.go needs no extra wiring.
type CustomScriptsService struct {
	Deps appcore.Deps
}

type (
	CustomScriptsCreateArgs           = quickcommands.CreateArgs
	CustomScriptsUpdateArgs           = quickcommands.UpdateArgs
	CustomScriptsRemoveArgs           = quickcommands.RemoveArgs
	CustomScriptsCreateCollectionArgs = quickcommands.CreateCollectionArgs
	CustomScriptsRenameCollectionArgs = quickcommands.RenameCollectionArgs
	CustomScriptsDeleteCollectionArgs = quickcommands.DeleteCollectionArgs
	CustomScriptsMoveArgs             = quickcommands.MoveArgs
)

func (s *CustomScriptsService) shared() *quickcommands.Service {
	return &quickcommands.Service{
		Repo: s.Deps.Repos.CustomScripts,
		Emit: func(snapshot quickcommands.Snapshot) {
			s.Deps.Events.Emit(ChannelCustomScriptsChanged, snapshot)
		},
	}
}

func (s *CustomScriptsService) List() (quickcommands.Snapshot, error) {
	return s.shared().List()
}

func (s *CustomScriptsService) Create(args CustomScriptsCreateArgs) (quickcommands.CustomScript, error) {
	return s.shared().Create(args)
}

func (s *CustomScriptsService) Update(args CustomScriptsUpdateArgs) (quickcommands.CustomScript, error) {
	return s.shared().Update(args)
}

func (s *CustomScriptsService) Remove(args CustomScriptsRemoveArgs) error {
	return s.shared().Remove(args)
}

func (s *CustomScriptsService) CreateCollection(args CustomScriptsCreateCollectionArgs) (quickcommands.Collection, error) {
	return s.shared().CreateCollection(args)
}

func (s *CustomScriptsService) RenameCollection(args CustomScriptsRenameCollectionArgs) error {
	return s.shared().RenameCollection(args)
}

func (s *CustomScriptsService) DeleteCollection(args CustomScriptsDeleteCollectionArgs) error {
	return s.shared().DeleteCollection(args)
}

func (s *CustomScriptsService) Move(args CustomScriptsMoveArgs) error {
	return s.shared().Move(args)
}
