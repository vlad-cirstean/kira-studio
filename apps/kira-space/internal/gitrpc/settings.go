package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpath"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// repoSettingsSnapshotFrom projects storage/model.GitRepoSettings onto the wire's own dotted-key
// shape (D4). ReviewBaseCandidates is normalised to a non-nil slice — a repo that has never
// patched it reads back model.DefaultGitRepoSettings()'s own literal, never nil, but this keeps
// the projection defensive against a future zero-value GitRepoSettings reaching here directly.
func repoSettingsSnapshotFrom(s model.GitRepoSettings) RepoSettingsSnapshot {
	candidates := s.ReviewBaseCandidates
	if candidates == nil {
		candidates = []string{}
	}
	return RepoSettingsSnapshot{
		GraphPageSize:         s.GraphPageSize,
		GraphScope:            s.GraphScope,
		StashShowInGraph:      s.StashShowInGraph,
		StashIncludeUntracked: s.StashIncludeUntracked,
		ReviewBaseCandidates:  candidates,
		PullStrategy:          s.PullStrategy,
		LogLevel:              s.LogLevel,
		GithubEnabled:         s.GithubEnabled,
		WorktreePrepareScript: s.WorktreePrepareScript,
		WorktreeBasePath:      s.WorktreeBasePath,
		CheckoutAutoStash:     s.CheckoutAutoStash,
	}
}

// toModel converts the wire's own dotted-key patch into storage/model's own patch shape — a plain
// field-for-field rename, since both are already "every leaf optional" (D4's own doc comment).
//
// G27 D5d: WorktreeBasePath is a client-supplied directory parameter (D2 tier 1), normalized to
// NFC when set to a non-empty value — nil (leave unset) and "" (explicitly reset to no override,
// storage/repos.gitreposettings_test.go's own precedent) both stay exactly as the client sent
// them; CleanNFC("") would turn a deliberate reset into ".", which is not what an empty patch
// value means here.
func (p RepoSettingsPatchWire) toModel() model.GitRepoSettingsPatch {
	worktreeBasePath := p.WorktreeBasePath
	if worktreeBasePath != nil && *worktreeBasePath != "" {
		v := gitpath.CleanNFC(*worktreeBasePath)
		worktreeBasePath = &v
	}
	return model.GitRepoSettingsPatch{
		GraphPageSize:         p.GraphPageSize,
		GraphScope:            p.GraphScope,
		StashShowInGraph:      p.StashShowInGraph,
		StashIncludeUntracked: p.StashIncludeUntracked,
		ReviewBaseCandidates:  p.ReviewBaseCandidates,
		PullStrategy:          p.PullStrategy,
		LogLevel:              p.LogLevel,
		GithubEnabled:         p.GithubEnabled,
		WorktreePrepareScript: p.WorktreePrepareScript,
		WorktreeBasePath:      worktreeBasePath,
		CheckoutAutoStash:     p.CheckoutAutoStash,
	}
}

func (r *Router) handleRepoSettingsGet(_ context.Context, _ *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleCall("repoSettings.get", params,
		func(p RepoSettingsGetParams) error {
			return requireNonEmpty("repoSettings.get", "repoId", p.RepoID)
		},
		func(p RepoSettingsGetParams) (RepoSettingsSnapshot, error) {
			s, err := r.deps.Registry.RepoSettingsGet(p.RepoID)
			if err != nil {
				return RepoSettingsSnapshot{}, ipcerr.New("E_INTERNAL", "gitrpc: repoSettings.get: "+err.Error())
			}
			return repoSettingsSnapshotFrom(s), nil
		},
	)
}

// handleRepoSettingsSet writes the patch, then emits repoSettings.changed to EVERY currently
// connected client (D7) — not only the one that made the change, via this Router's own
// notify.Emitter[RepoSettingsChangedPayload] (repoSettingsChanged, ForConn below). D14's
// log.level sentinel collapse is invisible here: RepoID still names whichever repo the caller
// passed, even for a log.level-only patch; the storage layer is what already made that write
// visible to every other repo.
func (r *Router) handleRepoSettingsSet(_ context.Context, _ *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleCall("repoSettings.set", params,
		func(p RepoSettingsSetParams) error {
			return requireNonEmpty("repoSettings.set", "repoId", p.RepoID)
		},
		func(p RepoSettingsSetParams) (RepoSettingsSnapshot, error) {
			s, err := r.deps.Registry.RepoSettingsSet(p.RepoID, p.Patch.toModel())
			if err != nil {
				return RepoSettingsSnapshot{}, ipcerr.BadRequest("gitrpc: repoSettings.set: " + err.Error())
			}
			snapshot := repoSettingsSnapshotFrom(s)
			r.repoSettingsChanged.Emit(RepoSettingsChangedPayload{RepoID: p.RepoID, Settings: snapshot})
			return snapshot, nil
		},
	)
}

// handleSettingsSetGitPath is G18 D11's own migration leg: writes kiraSpace.git.path's migrated
// value through Kira Space's own server-owned settings surface (storage/repos.SettingsRepo, via
// r.deps.SetGitPath) rather than repoSettings.set, since git.path never lived in the per-repo
// store (D15). Extension-only — proxyHandlers.ts never forwards a webview call here (the same
// posture credential.provide's own doc comment states for a different reason).
func (r *Router) handleSettingsSetGitPath(_ context.Context, params json.RawMessage) (any, error) {
	return handleCall("settings.setGitPath", params, nil,
		func(p SettingsSetGitPathParams) (struct{}, error) {
			if r.deps.SetGitPath == nil {
				return struct{}{}, ipcerr.New("E_INTERNAL", "gitrpc: settings.setGitPath: not wired")
			}
			// G27 D5d: a client-supplied directory parameter (D2 tier 1) -- normalized when
			// non-empty; "" (clear the override, fall back to auto-discovery) stays "" rather than
			// becoming ".".
			gitPath := p.GitPath
			if gitPath != "" {
				gitPath = gitpath.CleanNFC(gitPath)
			}
			if err := r.deps.SetGitPath(gitPath); err != nil {
				return struct{}{}, ipcerr.New("E_INTERNAL", "gitrpc: settings.setGitPath: "+err.Error())
			}
			return struct{}{}, nil
		},
	)
}
