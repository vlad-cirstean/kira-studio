package gitrpc

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// mapDetailError maps gitsession's own closed error vocabulary for this phase's four queries into
// ipcerr — every one of these is a caller mistake the webview cannot have made from data it read
// out of a previous result (D6/D8's own validation rules), so all three are E_BAD_REQUEST; any
// other error falls through to mapGitError, same as every other repo-touching handler.
func mapDetailError(err error) error {
	switch {
	case errors.Is(err, gitsession.ErrParentIndexOutOfRange):
		return ipcerr.BadRequest("gitrpc: parentIndex is out of range")
	case errors.Is(err, gitsession.ErrFileNotInCommit):
		return ipcerr.BadRequest("gitrpc: path is not one of this commit's changed files")
	case errors.Is(err, gitsession.ErrPathEscapesRoot):
		return ipcerr.BadRequest("gitrpc: path escapes the repository root")
	case errors.Is(err, gitsession.ErrBranchNotFound):
		return ipcerr.BadRequest("gitrpc: branch not found")
	case errors.Is(err, gitsession.ErrUnrelatedHistories):
		return ipcerr.BadRequest("gitrpc: base and branch share no history")
	case errors.Is(err, gitsession.ErrRangedMarkOnNonText):
		return ipcerr.BadRequest("gitrpc: a ranged mark requires a text file")
	default:
		return mapGitError(err)
	}
}

// entryFor resolves c's held RepoEntry for repoID, or ErrRepoNotHeld mapped the same way graph.*
// already maps it (D18) — repo.open must precede every one of these four methods, exactly as it
// must for every other per-repo request.
func entryFor(c *gitsession.Conn, repoID string) (*gitsession.RepoEntry, error) {
	entry, ok := c.Entry(repoID)
	if !ok {
		return nil, mapConnError(gitsession.ErrRepoNotHeld)
	}
	return entry, nil
}

func parentIndexOrDefault(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func stringOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (r *Router) handleCommitDetail(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p CommitDetailParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: commit.detail: invalid params")
	}
	if p.RepoID == "" || p.SHA == "" {
		return nil, ipcerr.BadRequest("gitrpc: commit.detail: repoId and sha are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	detail, err := entry.CommitDetail(ctx, p.SHA, parentIndexOrDefault(p.ParentIndex))
	if err != nil {
		return nil, mapDetailError(err)
	}
	return detail, nil
}

// handleCommitFileDiff is one of D2(b)'s two size-sensitive handlers: it marshals its own result
// once and, only if the *encoded* result exceeds MaxResultBytes, replaces the body with
// FileDiffBody's own "tooLarge" arm (carrying the real raw patch size, gitsession.FileDiffResult's
// own RawPatchBytes — never re-derived from the encoded bytes) and marshals again. Returned as
// json.RawMessage, which rpcstream's own json.Marshal passes through unchanged (D2's own note).
func (r *Router) handleCommitFileDiff(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p CommitFileDiffParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: commit.fileDiff: invalid params")
	}
	if p.RepoID == "" || p.SHA == "" || p.Path == "" {
		return nil, ipcerr.BadRequest("gitrpc: commit.fileDiff: repoId, sha and path are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.FileDiff(ctx, p.SHA, p.Path, stringOrEmpty(p.OriginalPath), parentIndexOrDefault(p.ParentIndex))
	if err != nil {
		return nil, mapDetailError(err)
	}

	raw, merr := json.Marshal(result)
	if merr != nil {
		return nil, ipcerr.Internal(merr.Error())
	}
	if len(raw) > MaxResultBytes {
		result.Body = porcelain.FileDiffBody{Kind: porcelain.BodyTooLarge, Bytes: result.RawPatchBytes, LimitBytes: MaxResultBytes}
		raw, merr = json.Marshal(result)
		if merr != nil {
			return nil, ipcerr.Internal(merr.Error())
		}
	}
	return json.RawMessage(raw), nil
}

// handleFileRead is D2(b)'s other size-sensitive handler — the same marshal-once, cap-check,
// re-marshal-if-needed shape as commit.fileDiff, over file.read's own result union.
func (r *Router) handleFileRead(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p FileReadParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: file.read: invalid params")
	}
	if p.RepoID == "" || p.Rev == "" || p.Path == "" {
		return nil, ipcerr.BadRequest("gitrpc: file.read: repoId, rev and path are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.Blob(ctx, p.Rev, p.Path)
	if err != nil {
		return nil, mapDetailError(err)
	}

	raw, merr := json.Marshal(result)
	if merr != nil {
		return nil, ipcerr.Internal(merr.Error())
	}
	if len(raw) > MaxResultBytes {
		result = gitsession.BlobResult{Kind: "tooLarge", Bytes: int64(len(result.Content)), LimitBytes: MaxResultBytes}
		raw, merr = json.Marshal(result)
		if merr != nil {
			return nil, ipcerr.Internal(merr.Error())
		}
	}
	return json.RawMessage(raw), nil
}

func (r *Router) handleFileGoToTarget(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p FileGoToTargetParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: file.goToTarget: invalid params")
	}
	if p.RepoID == "" || p.Rev == "" || p.Path == "" {
		return nil, ipcerr.BadRequest("gitrpc: file.goToTarget: repoId, rev and path are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.GoToTarget(ctx, p.Rev, p.Path)
	if err != nil {
		return nil, mapDetailError(err)
	}
	return result, nil
}
