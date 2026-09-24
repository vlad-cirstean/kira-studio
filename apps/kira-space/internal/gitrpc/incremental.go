package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// D19: thin dispatch, three handlers — decode, validate (repoId/branch/path non-empty, validRefArg
// on branch/base, the same guard review.resolveBase already uses at the same entrance), entryFor,
// one RepoEntry call, marshal (with D15's size guard on review.fileDiff). No handler here computes
// anything itself.

func (r *Router) handleReviewFiles(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "review.files", params,
		func(p ReviewFilesParams) (string, error) {
			if err := requireNonEmpty("review.files", "repoId", p.RepoID); err != nil {
				return "", err
			}
			if err := validRefArg("branch", p.Branch); err != nil {
				return "", err
			}
			if err := validRefArg("base", p.Base); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p ReviewFilesParams) (json.RawMessage, error) {
			result, err := entry.RangeFiles(ctx, p.Base, p.Branch)
			if err != nil {
				return nil, mapDetailError(err)
			}

			// D15: a file list has no `tooLarge` arm, so an over-cap list is an E_TOO_LARGE-shaped
			// ipcerr naming the file count — unreachable in practice (a FileChange +
			// ReviewFileStatus is well under 300 bytes), but "unreachable" is not "unhandled".
			raw, merr := json.Marshal(result)
			if merr != nil {
				return nil, ipcerr.Internal(merr.Error())
			}
			if len(raw) > MaxResultBytes {
				return nil, ipcerr.New("E_TOO_LARGE", "gitrpc: review.files: result too large")
			}
			return json.RawMessage(raw), nil
		},
	)
}

// handleReviewFileDiff is D15's other size-sensitive handler here: the same marshal-once /
// check MaxResultBytes / replace-body-with-tooLarge / re-marshal shape commit.fileDiff already
// uses — the body is the same FileDiffBody union, so the same {kind: "tooLarge", ...} arm applies
// with no new type.
func (r *Router) handleReviewFileDiff(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "review.fileDiff", params,
		func(p ReviewFileDiffParams) (string, error) {
			if err := requireNonEmpty("review.fileDiff", "repoId", p.RepoID, "path", p.Path); err != nil {
				return "", err
			}
			if err := validRefArg("branch", p.Branch); err != nil {
				return "", err
			}
			if err := validRefArg("base", p.Base); err != nil {
				return "", err
			}
			if p.Mode != "range" && p.Mode != "sinceReview" {
				return "", ipcerr.BadRequest("gitrpc: review.fileDiff: mode must be \"range\" or \"sinceReview\"")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p ReviewFileDiffParams) (json.RawMessage, error) {
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
		},
	)
}

func (r *Router) handleReviewMark(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "review.mark", params,
		func(p ReviewMarkParams) (string, error) {
			if err := requireNonEmpty("review.mark", "repoId", p.RepoID, "path", p.Path); err != nil {
				return "", err
			}
			if err := validRefArg("branch", p.Branch); err != nil {
				return "", err
			}
			// F7 (P108 Part 17 review): gitreview.Normalize only drops a range where End < Start,
			// and clampToLineCount only clamps the UPPER bound — so a range like {Start:-9, End:0}
			// on a 10-line file was accepted and stored, and CountLines then equalled the file's
			// own lineCount, reading as "fully reviewed" with zero actual lines marked. Every
			// element is checked, not just the first — comments.go's own review.comment.add
			// validation right above enforces the identical rule.
			for _, rng := range p.Ranges {
				if rng.Start < 1 || rng.End < rng.Start {
					return "", ipcerr.BadRequest("gitrpc: review.mark: range must satisfy 1 <= start <= end")
				}
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p ReviewMarkParams) (ReviewMarkResult, error) {
			rec, err := entry.MarkFile(ctx, p.Branch, p.Path, p.Reviewed, p.Ranges)
			if err != nil {
				return ReviewMarkResult{}, mapDetailError(err)
			}
			return ReviewMarkResult{Review: gitsession.ReviewFileStatusFor(rec)}, nil
		},
	)
}
