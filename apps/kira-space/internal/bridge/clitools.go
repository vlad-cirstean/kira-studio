package bridge

import "github.com/kirathecat/kira-studio/apps/kira-space/internal/clisetup"

// ToolsArgs is IssueTrackerService.Tools' request. Refresh drops each CLI's cached probe first.
type ToolsArgs struct {
	Refresh bool `json:"refresh"`
}

// Tool kinds.
const (
	ToolKindHost    = "host"
	ToolKindTracker = "tracker"
)

// Tool is one local CLI Settings explains: a code host's or an issue tracker's.
type Tool struct {
	Kind     string         `json:"kind"` // host | tracker
	Provider string         `json:"provider"`
	Label    string         `json:"label"` // GitHub, Jira
	CLI      string         `json:"cli"`   // GitHub CLI (gh)
	Setup    clisetup.Setup `json:"setup"`
	Status   ToolStatus     `json:"status"`
}

// ToolStatus is a CLI's install and sign-in state.
type ToolStatus struct {
	Kind    string   `json:"kind"` // ok | notFound | unauthenticated | forbidden
	Path    string   `json:"path"`
	Version string   `json:"version"`
	Account string   `json:"account"`
	Site    string   `json:"site"`
	Reason  string   `json:"reason"`
	Probed  []string `json:"probed"`
}

// ToolsResult lists code host CLIs first, then issue tracker CLIs, each in registration order.
type ToolsResult struct {
	Tools []Tool `json:"tools"`
}

// TrackerInfo names one issue tracker without probing its CLI.
type TrackerInfo struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Issue string `json:"issue"`
}

// TrackersResult lists the registered issue trackers.
type TrackersResult struct {
	Trackers []TrackerInfo `json:"trackers"`
}
