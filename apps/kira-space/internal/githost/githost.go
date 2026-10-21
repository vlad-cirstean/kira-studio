// Package githost is the provider-neutral contract for a repository's code host (GitHub, GitLab, ...).
// Callers depend on the narrowest role interface; each provider keeps its own credentials, CLI and
// API client. "Change request" is the neutral name for a pull or merge request.
package githost

import (
	"context"
	"net/url"
)

// Repo is one hosted repository. Owner may be a nested group path for hosts that allow one.
type Repo struct{ Host, Owner, Name string }

// ChangeRequest is one pull or merge request.
type ChangeRequest struct {
	Number  int    `json:"number"`
	Title   string `json:"title"`
	URL     string `json:"url"`
	State   string `json:"state"` // "open" | "draft" | "merged" | "closed"
	HeadRef string `json:"headRef"`
	HeadSha string `json:"headSha"`
	// HeadOwner owns the repo HeadRef lives in; "" when the source repo is gone.
	HeadOwner string `json:"headOwner"`
	BaseRef   string `json:"baseRef"`
	UpdatedAt int64  `json:"updatedAt"` // Unix milliseconds.
}

// Status kinds.
const (
	KindOK              = "ok"
	KindNotFound        = "notFound"
	KindUnauthenticated = "unauthenticated"
	KindForbidden       = "forbidden"
)

// Status is a host call's actionability.
type Status struct {
	Kind    string   `json:"kind"`
	Path    string   `json:"path,omitempty"` // CLI path, when the host uses one.
	Version string   `json:"version,omitempty"`
	Host    string   `json:"host,omitempty"`
	Account string   `json:"account,omitempty"`
	Probed  []string `json:"probed,omitempty"`
	Reason  string   `json:"reason,omitempty"`
	// RateLimited arms the per-repo breaker.
	RateLimited bool `json:"-"`
}

// OK reports whether s is a successful probe or call.
func (s Status) OK() bool { return s.Kind == KindOK }

// Link is a pasted issue or change-request link a provider recognised.
type Link struct {
	Provider string `json:"provider"`
	Kind     string `json:"kind"` // "changeRequest" | "issue"
	Ref      string `json:"ref"`  // display ref
}

// Link kinds.
const (
	LinkChangeRequest = "changeRequest"
	LinkIssue         = "issue"
)

// ChangedFile is one file of a change request and whether the viewer marked it viewed.
type ChangedFile struct {
	Path   string
	Viewed bool
}

// ChangeFiles is a change request's files with the viewer's viewed state.
type ChangeFiles struct {
	NodeID, HeadSha string
	Open            bool
	Files           []ChangedFile
	Truncated       bool
}

// Provider is one code host.
type Provider interface {
	// ID is the setting value, e.g. "github".
	ID() string
	Terms() Terms
	Remotes
	Auth
	ChangeRequests
	URLs
}

// Remotes is repository and remote identity.
type Remotes interface {
	ParseRemote(remoteURL string) (Repo, bool)
	// Claims reports whether host belongs to this provider, for auto detection.
	Claims(ctx context.Context, host string) bool
}

// Auth is the host account the user is signed in as. A provider owns its credentials; Kira holds none.
type Auth interface {
	Status(ctx context.Context, host string) Status
	Account(ctx context.Context, host string) string
}

// ChangeRequests reads pull or merge requests. Every call reports failure in Status, never an error.
type ChangeRequests interface {
	ForCommit(ctx context.Context, r Repo, sha string) ([]ChangeRequest, Status)
	// ForBranch includes closed ones, newest first.
	ForBranch(ctx context.Context, r Repo, branch string) ([]ChangeRequest, Status)
	// Open is the repo-wide open snapshot, bounded by the provider.
	Open(ctx context.Context, r Repo) ([]ChangeRequest, Status)
}

// URLs builds and checks browser links. Composed server-side only.
type URLs interface {
	ChangeRequestURL(r Repo, number int) string
	RepoURL(r Repo) string
	BranchURL(r Repo, branch string) string
	// IsChangeRequestURL re-validates a composed URL right before the OS browser opens it.
	IsChangeRequestURL(ctx context.Context, u *url.URL) bool
	ParseLink(raw string) (Link, bool)
}

// FileReviewSync is optional: the host stores per-file viewed state on a change request.
type FileReviewSync interface {
	ChangeFiles(ctx context.Context, r Repo, number int) (ChangeFiles, Status)
	// SetFilesViewed marks or unmarks paths; failed maps a path to the host's error for it.
	SetFilesViewed(ctx context.Context, r Repo, nodeID string, paths []string, viewed bool) (failed map[string]string, s Status)
}
