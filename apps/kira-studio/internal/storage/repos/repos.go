package repos

import (
	"database/sql"
	"fmt"
)

// Repos is every storage repo that needs no cipher, constructed once at startup. SecretsRepo is
// deliberately not a member — it needs a Cipher that does not exist until P55, so it is
// constructed separately via NewSecrets (D5).
type Repos struct {
	Settings      *SettingsRepo
	Layout        *LayoutRepo
	Tabs          *TabsRepo
	Windows       *WindowsRepo
	Connections   *ConnectionsRepo
	Ops           *OpsRepo
	Filters       *FiltersRepo
	SavedQueries  *SavedQueriesRepo
	FilterHistory *FilterHistoryRepo
	Metadata      *MetadataCacheRepo

	stmts []*sql.Stmt // every prepared statement below, for Close.
}

// New prepares P52 §5.4's five hot statements once (settings read, layout read, tabs list,
// op-log append/finish) and constructs every repo that needs no cipher.
func New(db *sql.DB) (*Repos, error) {
	settingsSelectAll, err := db.Prepare(settingsSelectAllSQL)
	if err != nil {
		return nil, fmt.Errorf("repos: prepare settings select: %w", err)
	}
	layoutSelectAll, err := db.Prepare(layoutSelectAllSQL)
	if err != nil {
		return nil, fmt.Errorf("repos: prepare layout select: %w", err)
	}
	tabsSelectAll, err := db.Prepare(tabsSelectAllSQL)
	if err != nil {
		return nil, fmt.Errorf("repos: prepare tabs select: %w", err)
	}
	opsInsert, err := db.Prepare(opsInsertSQL)
	if err != nil {
		return nil, fmt.Errorf("repos: prepare ops insert: %w", err)
	}
	opsUpdate, err := db.Prepare(opsUpdateSQL)
	if err != nil {
		return nil, fmt.Errorf("repos: prepare ops update: %w", err)
	}

	return &Repos{
		Settings:      &SettingsRepo{DB: db, selectAll: settingsSelectAll},
		Layout:        &LayoutRepo{DB: db, selectAll: layoutSelectAll},
		Tabs:          &TabsRepo{DB: db, selectAll: tabsSelectAll},
		Windows:       &WindowsRepo{DB: db},
		Connections:   &ConnectionsRepo{DB: db},
		Ops:           &OpsRepo{DB: db, insert: opsInsert, update: opsUpdate},
		Filters:       &FiltersRepo{DB: db},
		SavedQueries:  &SavedQueriesRepo{DB: db},
		FilterHistory: &FilterHistoryRepo{DB: db},
		Metadata:      &MetadataCacheRepo{DB: db},
		stmts:         []*sql.Stmt{settingsSelectAll, layoutSelectAll, tabsSelectAll, opsInsert, opsUpdate},
	}, nil
}

// Close releases every prepared statement. It does not close the underlying *sql.DB, which the
// caller (main.go) owns.
func (r *Repos) Close() error {
	for _, stmt := range r.stmts {
		if err := stmt.Close(); err != nil {
			return fmt.Errorf("repos: close statement: %w", err)
		}
	}
	return nil
}
