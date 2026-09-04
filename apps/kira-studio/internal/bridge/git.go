package bridge

import (
	"context"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// GitHostKind is this app's own member of @kira/git-ipc's HostKind union (packages/git-ipc/src/contract.ts) —
// carried as a literal (Go cannot import TypeScript, matching gitclient/settings.go's own
// SettingsSnapshot precedent) rather than derived.
const GitHostKind = "kira-studio"

// GitContractVersion mirrors @kira/git-ipc's CONTRACT_VERSION (packages/git-ipc/src/validate.ts) —
// bumped there whenever the frame union changes; gitstream.go's own envelope wraps/unwraps this
// same number so a stale build talking to a fresh one fails loudly (validate.ts's own doc
// comment) rather than half-working.
const GitContractVersion = 3

// GitService is P1 D1's bound service: gitclient.Client's own methods, thin-adapted the same way
// bridge/http.go wraps httpclient.Send — validate args, delegate, map errors to ipcerr. Every
// method here doubles as gitstream.go's own frame-dispatch target: the "git" stream's RPC server
// calls these directly (a plain Go function call, not a second bound-call round trip) to fulfil
// each of @kira/git-ipc's contract.ts request methods, so the logic exists exactly once regardless
// of which of the two surfaces (a bound call, or a stream frame) reaches it.
type GitService struct {
	Client  *gitclient.Client
	Dialogs Dialogs
}

// GitInitResult is app.init's result — structurally matches @kira/git-ipc's own
// Contract['requests']['app.init']['result'].
type GitInitResult struct {
	Host            string                     `json:"host"`
	ContractVersion int                        `json:"contractVersion"`
	Settings        gitclient.SettingsSnapshot `json:"settings"`
	Git             gitclient.GitStatus        `json:"git"`
}

// Init answers app.init: this host's identity, the contract version, git-core's fixed setting
// defaults (OQ-2), and D4's own GitStatus discriminant.
func (s *GitService) Init(ctx context.Context) (GitInitResult, error) {
	return GitInitResult{
		Host:            GitHostKind,
		ContractVersion: GitContractVersion,
		Settings:        gitclient.DefaultSettings(),
		Git:             s.Client.Status(ctx, ""),
	}, nil
}

// GitRepoListResult is repo.list's result. P1 has no persisted recent-repository list to offer
// (that surface, if this app ever wants one, is a later phase's own decision, not carried from
// the source project's own VS Code workspace-folder integration — docs/v1.3/SPEC.md's "What
// deliberately does not come across") — an always-empty candidate list with no active repo is the
// honest answer, and it is exactly what drives NoRepositoryPanel.vue to its "Open Folder…" action.
type GitRepoListResult struct {
	Candidates   []gitclient.RepoCandidate `json:"candidates"`
	ActiveRepoID *string                   `json:"activeRepoId"`
}

// ListRepos answers repo.list.
func (s *GitService) ListRepos() (GitRepoListResult, error) {
	return GitRepoListResult{Candidates: []gitclient.RepoCandidate{}, ActiveRepoID: nil}, nil
}

// GitRepoPickResult is repo.pick's result.
type GitRepoPickResult struct {
	Path *string `json:"path"`
}

// PickRepo answers repo.pick: a native directory picker (Dialogs.OpenDirectory), reusing the same
// seam FilesService already uses for a file picker. No ctx — Wails' dialog APIs carry no
// cancellation of their own, matching FilesService.ChooseOpen's identical shape.
func (s *GitService) PickRepo() (GitRepoPickResult, error) {
	path, err := s.Dialogs.OpenDirectory(OpenDirectoryRequest{Title: "Open Repository"})
	if err != nil {
		return GitRepoPickResult{}, ipcerr.Internal(err.Error())
	}
	if path == "" {
		return GitRepoPickResult{Path: nil}, nil
	}
	return GitRepoPickResult{Path: &path}, nil
}

// GitRepoOpenArgs is repo.open's params.
type GitRepoOpenArgs struct {
	Path string `json:"path"`
}

// OpenRepo answers repo.open.
func (s *GitService) OpenRepo(ctx context.Context, args GitRepoOpenArgs) (gitclient.RepoOpenResult, error) {
	if args.Path == "" {
		return gitclient.RepoOpenResult{}, ipcerr.BadRequest("path is required")
	}
	result, err := s.Client.OpenRepo(ctx, "", args.Path)
	if err != nil {
		return gitclient.RepoOpenResult{}, mapGitError(err)
	}
	return result, nil
}

// GitRepoCloseArgs is repo.close's params.
type GitRepoCloseArgs struct {
	RepoID string `json:"repoId"`
}

// GitEmpty is every `Record<string, never>` result in contract.ts — marshals to `{}`.
type GitEmpty struct{}

// CloseRepo answers repo.close. Closing an id that is not (or no longer) open is a no-op, not an
// error — mirrors repo.ts's own close(), which never checked before calling this either.
func (s *GitService) CloseRepo(args GitRepoCloseArgs) (GitEmpty, error) {
	if args.RepoID == "" {
		return GitEmpty{}, ipcerr.BadRequest("repoId is required")
	}
	s.Client.CloseRepo(args.RepoID)
	return GitEmpty{}, nil
}

// GitGraphStatusArgs/Result answer graph.status.
type GitGraphStatusArgs struct {
	RepoID string `json:"repoId"`
}
type GitGraphStatusResult struct {
	Loaded    int  `json:"loaded"`
	Remaining int  `json:"remaining"`
	Exhausted bool `json:"exhausted"`
}

// GraphStatus answers graph.status. P1 opens a repo and reports its identity but walks no commits
// (§0.1's own boundary — the paged `git log` walk is P2's) — every open repo therefore reports
// zero loaded, zero remaining, already exhausted, which is what tells CommitGrid/LoadMoreButton
// there is nothing to page through yet, honestly, rather than a fabricated count.
func (s *GitService) GraphStatus(args GitGraphStatusArgs) (GitGraphStatusResult, error) {
	if args.RepoID == "" {
		return GitGraphStatusResult{}, ipcerr.BadRequest("repoId is required")
	}
	if _, ok := s.Client.Registry.Get(args.RepoID); !ok {
		return GitGraphStatusResult{}, ipcerr.New("E_NOT_FOUND", "no such open repository: "+args.RepoID)
	}
	return GitGraphStatusResult{Loaded: 0, Remaining: 0, Exhausted: true}, nil
}

// GitGraphLoadMoreArgs/Result answer graph.loadMore.
type GitGraphLoadMoreArgs struct {
	RepoID string `json:"repoId"`
	Pages  *int   `json:"pages,omitempty"`
}
type GitGraphLoadMoreResult struct {
	Started bool `json:"started"`
}

// GraphLoadMore answers graph.loadMore — always "did not start" (§0.1: no walk exists to start).
func (s *GitService) GraphLoadMore(args GitGraphLoadMoreArgs) (GitGraphLoadMoreResult, error) {
	if args.RepoID == "" {
		return GitGraphLoadMoreResult{}, ipcerr.BadRequest("repoId is required")
	}
	if _, ok := s.Client.Registry.Get(args.RepoID); !ok {
		return GitGraphLoadMoreResult{}, ipcerr.New("E_NOT_FOUND", "no such open repository: "+args.RepoID)
	}
	return GitGraphLoadMoreResult{Started: false}, nil
}

// GitGraphRefreshArgs/Result answer graph.refresh.
type GitGraphRefreshArgs struct {
	RepoID string `json:"repoId"`
}
type GitGraphRefreshResult struct {
	Restarted bool `json:"restarted"`
}

// GraphRefresh answers graph.refresh — always "did not restart" (same reasoning as GraphLoadMore).
func (s *GitService) GraphRefresh(args GitGraphRefreshArgs) (GitGraphRefreshResult, error) {
	if args.RepoID == "" {
		return GitGraphRefreshResult{}, ipcerr.BadRequest("repoId is required")
	}
	if _, ok := s.Client.Registry.Get(args.RepoID); !ok {
		return GitGraphRefreshResult{}, ipcerr.New("E_NOT_FOUND", "no such open repository: "+args.RepoID)
	}
	return GitGraphRefreshResult{Restarted: false}, nil
}

// mapGitError joins gitclient's own error kinds into the ipcerr family (mirrors bridge/http.go's
// mapHttpError) — not adapters.ErrorCode, for the same reason httpclient's mapping isn't: a code
// meant for "the database connection is gone" would misclassify a git spawn failure.
func mapGitError(err error) error {
	var gerr *gitclient.Error
	if errors.As(err, &gerr) {
		switch gerr.Kind {
		case gitclient.KindPermissionDenied:
			return ipcerr.New("E_PERMISSION_DENIED", gerr.Error())
		case gitclient.KindCancelled:
			return ipcerr.New("E_CANCELLED", gerr.Error())
		case gitclient.KindTimeout:
			return ipcerr.New("E_TIMEOUT", gerr.Error())
		default:
			return ipcerr.Internal(gerr.Error())
		}
	}
	return ipcerr.Internal(err.Error())
}
