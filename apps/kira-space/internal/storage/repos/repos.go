package repos

import (
	"database/sql"
	"fmt"
)

// Repos is every storage repo this app needs, constructed once at startup — Kira Studio's own
// Repos aggregate carries eighteen repos across connections/queries/collections/history/git;
// Kira Space's own trimmed copy (P100 Part 1) carried only the five this app's own services
// (GitClientsService, CodeWorkspaceService, GithubService, this app's own window shell, and
// SettingsService reads for advanced.gitLogLevel/git.*) actually touched. Layout and Tabs are
// P100 Part 2's own addition, once the frontend gave both a real consumer
// (migrations/0002_p100_tabs_layout.sql).
type Repos struct {
	Settings        *SettingsRepo
	Windows         *WindowsRepo
	GitClients      *GitClientsRepo
	GitRepoSettings *GitRepoSettingsRepo
	CodeRepos       *CodeReposRepo
	Layout          *LayoutRepo
	Tabs            *TabsRepo

	stmts []*sql.Stmt // every prepared statement below, for Close.
}

// New prepares the settings and layout reads (this app's own hot boot-path reads, the same
// "prepare it once" treatment Kira Studio's own repos.New gives its settings/layout/tabs reads)
// and constructs every repo.
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

	return &Repos{
		Settings:        &SettingsRepo{DB: db, selectAll: settingsSelectAll},
		Windows:         &WindowsRepo{DB: db},
		GitClients:      &GitClientsRepo{DB: db},
		GitRepoSettings: &GitRepoSettingsRepo{DB: db},
		CodeRepos:       &CodeReposRepo{DB: db},
		Layout:          &LayoutRepo{DB: db, selectAll: layoutSelectAll},
		Tabs:            &TabsRepo{DB: db, selectAll: tabsSelectAll},
		stmts:           []*sql.Stmt{settingsSelectAll, layoutSelectAll, tabsSelectAll},
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
