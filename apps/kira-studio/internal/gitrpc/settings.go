package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
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
	}
}

// toModel converts the wire's own dotted-key patch into storage/model's own patch shape — a plain
// field-for-field rename, since both are already "every leaf optional" (D4's own doc comment).
func (p RepoSettingsPatchWire) toModel() model.GitRepoSettingsPatch {
	return model.GitRepoSettingsPatch{
		GraphPageSize:         p.GraphPageSize,
		GraphScope:            p.GraphScope,
		StashShowInGraph:      p.StashShowInGraph,
		StashIncludeUntracked: p.StashIncludeUntracked,
		ReviewBaseCandidates:  p.ReviewBaseCandidates,
		PullStrategy:          p.PullStrategy,
		LogLevel:              p.LogLevel,
	}
}

func (r *Router) handleRepoSettingsGet(_ context.Context, _ *gitsession.Conn, params json.RawMessage) (any, error) {
	var p RepoSettingsGetParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: repoSettings.get: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: repoSettings.get: repoId is required")
	}
	s, err := r.deps.Registry.RepoSettingsGet(p.RepoID)
	if err != nil {
		return nil, ipcerr.New("E_INTERNAL", "gitrpc: repoSettings.get: "+err.Error())
	}
	return repoSettingsSnapshotFrom(s), nil
}

// handleRepoSettingsSet writes the patch, then emits repoSettings.changed to EVERY currently
// connected client (D7) — not only the one that made the change, via this Router's own
// notify.Emitter[RepoSettingsChangedPayload] (repoSettingsChanged, ForConn below). D14's
// log.level sentinel collapse is invisible here: RepoID still names whichever repo the caller
// passed, even for a log.level-only patch; the storage layer is what already made that write
// visible to every other repo.
func (r *Router) handleRepoSettingsSet(_ context.Context, _ *gitsession.Conn, params json.RawMessage) (any, error) {
	var p RepoSettingsSetParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: repoSettings.set: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: repoSettings.set: repoId is required")
	}
	s, err := r.deps.Registry.RepoSettingsSet(p.RepoID, p.Patch.toModel())
	if err != nil {
		return nil, ipcerr.BadRequest("gitrpc: repoSettings.set: " + err.Error())
	}
	snapshot := repoSettingsSnapshotFrom(s)
	r.repoSettingsChanged.Emit(RepoSettingsChangedPayload{RepoID: p.RepoID, Settings: snapshot})
	return snapshot, nil
}
