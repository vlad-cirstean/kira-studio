package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/scripts"
)

// CustomScriptsService is this app's binding-name shim over internal/scripts.Service (the
// store, validation and the list-changed broadcast live there once, shared with the other app).
// It reaches s.Deps.Repos.CustomScripts directly, so main.go needs no extra wiring.
type CustomScriptsService struct {
	Deps appcore.Deps
	// Changed runs after every mutation (the scheduler reloads).
	Changed func()
}

type (
	CustomScriptsCreateArgs             = scripts.CreateArgs
	CustomScriptsUpdateArgs             = scripts.UpdateArgs
	CustomScriptsDeleteArgs             = scripts.DeleteArgs
	CustomScriptsCreateCollectionArgs   = scripts.CreateCollectionArgs
	CustomScriptsRenameCollectionArgs   = scripts.RenameCollectionArgs
	CustomScriptsDeleteCollectionArgs   = scripts.DeleteCollectionArgs
	CustomScriptsMoveArgs               = scripts.MoveArgs
	CustomScriptsReorderArgs            = scripts.ReorderArgs
	CustomScriptsReorderCollectionsArgs = scripts.ReorderCollectionsArgs
)

func (s *CustomScriptsService) shared() *scripts.Service {
	return &scripts.Service{
		Repo: s.Deps.Repos.CustomScripts,
		Home: s.Deps.Home, OnChange: s.Changed,
		Emit: func(snapshot scripts.Snapshot) {
			s.Deps.Events.Emit(ChannelCustomScriptsChanged, snapshot)
		},
	}
}

func (s *CustomScriptsService) List() (scripts.Snapshot, error) {
	return s.shared().List()
}

func (s *CustomScriptsService) Create(args CustomScriptsCreateArgs) (scripts.CustomScript, error) {
	return s.shared().Create(args)
}

func (s *CustomScriptsService) Update(args CustomScriptsUpdateArgs) (scripts.CustomScript, error) {
	return s.shared().Update(args)
}

func (s *CustomScriptsService) Delete(args CustomScriptsDeleteArgs) error {
	return s.shared().Delete(args)
}

func (s *CustomScriptsService) CreateCollection(args CustomScriptsCreateCollectionArgs) (scripts.Collection, error) {
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

func (s *CustomScriptsService) Reorder(args CustomScriptsReorderArgs) error {
	return s.shared().Reorder(args)
}

func (s *CustomScriptsService) ReorderCollections(args CustomScriptsReorderCollectionsArgs) error {
	return s.shared().ReorderCollections(args)
}
