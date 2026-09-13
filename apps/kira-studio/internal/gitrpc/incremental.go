package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// D19: thin dispatch, three handlers — decode, validate (repoId/branch/path non-empty, validRefArg
// on branch/base, the same guard review.resolveBase already uses at the same entrance), entryFor,
// one RepoEntry call, marshal (with D15's size guard on review.fileDiff). No handler here computes
// anything itself.

func (r *Router) handleReviewFiles(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p ReviewFilesParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: review.files: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: review.files: repoId is required")
	}
	if err := validRefArg("branch", p.Branch); err != nil {
		return nil, err
	}
	if err := validRefArg("base", p.Base); err != nil {
		return nil, err
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.RangeFiles(ctx, p.Base, p.Branch)
	if err != nil {
		return nil, mapDetailError(err)
	}

	// D15: a file list has no `tooLarge` arm, so an over-cap list is an E_TOO_LARGE-shaped ipcerr
	// naming the file count — unreachable in practice (a FileChange + ReviewFileStatus is well
	// under 300 bytes), but "unreachable" is not "unhandled".
	raw, merr := json.Marshal(result)
	if merr != nil {
		return nil, ipcerr.Internal(merr.Error())
	}
	if len(raw) > MaxResultBytes {
		return nil, ipcerr.New("E_TOO_LARGE", "gitrpc: review.files: result too large")
	}
	return json.RawMessage(raw), nil
}

// handleReviewFileDiff is D15's other size-sensitive handler here: the same marshal-once /
// check MaxResultBytes / replace-body-with-tooLarge / re-marshal shape commit.fileDiff already
// uses — the body is the same FileDiffBody union, so the same {kind: "tooLarge", ...} arm applies
// with no new type.
func (r *Router) handleReviewFileDiff(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p ReviewFileDiffParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: review.fileDiff: invalid params")
	}
	if p.RepoID == "" || p.Path == "" {
		return nil, ipcerr.BadRequest("gitrpc: review.fileDiff: repoId and path are required")
	}
	if err := validRefArg("branch", p.Branch); err != nil {
		return nil, err
	}
	if err := validRefArg("base", p.Base); err != nil {
		return nil, err
	}
	if p.Mode != "range" && p.Mode != "sinceReview" {
		return nil, ipcerr.BadRequest("gitrpc: review.fileDiff: mode must be \"range\" or \"sinceReview\"")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.ReviewFileDiff(ctx, p.Base, p.Branch, p.Path, p.Mode)
	if err != nil {
		return nil, mapDetailError(err)
	}

	raw, merr := json.Marshal(result)
	if merr != nil {
		return nil, ipcerr.Internal(merr.Error())
	}
	if len(raw) > MaxResultBytes {
		result.Body = porcelain.FileDiffBody{Kind: porcelain.BodyTooLarge, Bytes: int64(len(raw)), LimitBytes: MaxResultBytes}
		raw, merr = json.Marshal(result)
		if merr != nil {
			return nil, ipcerr.Internal(merr.Error())
		}
	}
	return json.RawMessage(raw), nil
}

func (r *Router) handleReviewMark(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p ReviewMarkParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: review.mark: invalid params")
	}
	if p.RepoID == "" || p.Path == "" {
		return nil, ipcerr.BadRequest("gitrpc: review.mark: repoId and path are required")
	}
	if err := validRefArg("branch", p.Branch); err != nil {
		return nil, err
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	rec, err := entry.MarkFile(ctx, p.Branch, p.Path, p.Reviewed, p.Ranges)
	if err != nil {
		return nil, mapDetailError(err)
	}
	return ReviewMarkResult{Review: gitsession.ReviewFileStatusFor(rec)}, nil
}
