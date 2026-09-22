// Package appcore is Kira Space's own Deps struct — the P100 Part 1 trimmed sibling of Kira
// Studio's own apps/kira-studio/internal/appcore, embedded by value into each bound service the
// same way. Kira Studio's Deps carries eight fields across connections/adapters/variables/mask
// rules/git; this app has no adapters, no connections, no HTTP variables — Repos, Events and
// GitRegistry are the whole surface the four moved bridge services (GitClientsService,
// CodeWorkspaceService, GitHubService, gitstream.go's ServeGitStream) actually read.
package appcore

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

// Emitter is the Go->renderer push seam (Kira Studio's own appcore.Emitter, same three methods) —
// internal/shell implements it over *application.App's Event.Emit/DispatchWailsEvent; bridge
// stays the only real consumer package, so no bridge file has to import Wails.
type Emitter interface {
	Emit(name string, data any)
	EmitTo(windowKey string, name string, data any)
	EmitFocused(name string, data any)
}

// Deps is embedded by value into every bound service struct.
type Deps struct {
	Repos  *repos.Repos
	Events Emitter
	// GitRegistry is internal/gitsession's own Registry — bridge/github.go's GitHubService reads
	// it to build its own known-GitHub-hosts allowlist (the same seam Kira Studio's own Deps
	// carries it for). May be nil in a fixture that never wires the git module.
	GitRegistry *gitsession.Registry
}
