package gitrpc

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// D17: thin dispatch, five handlers — decode, D15's shape validation, entryFor, one RepoEntry
// call, marshal (with two size guards, following G11 D15 exactly). No handler here computes
// anything itself.

// MaxCommentBytes is D15's own cap on one comment's body, applied AFTER \r\n/\r normalisation —
// roughly 1,200 words, far past anything typed into a gutter, and what bounds review.comment.list/
// export deterministically.
const MaxCommentBytes = 8 << 10

// objectIDPattern is D15's own shape check on `at`: a sha-1 or sha-256 object id, lowercase.
var objectIDPattern = regexp.MustCompile(`^[0-9a-f]{40}$|^[0-9a-f]{64}$`)

func validObjectID(field, value string) error {
	if !objectIDPattern.MatchString(value) {
		return ipcerr.BadRequest("gitrpc: " + field + " must be a 40- or 64-character lowercase hex object id")
	}
	return nil
}

// normalizeCommentBody is D15's own body rule: \r\n and \r normalise to \n, then the whole body is
// trimmed — a whitespace-only body trims to "" and is refused as empty, never stored as a
// whitespace note.
func normalizeCommentBody(raw string) string {
	normalized := strings.ReplaceAll(raw, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	return strings.TrimSpace(normalized)
}

func (r *Router) handleReviewCommentAdd(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var body string // set by resolve, read by call — normalizeCommentBody need run only once.
	return handleRepoCall(ctx, c, "review.comment.add", params,
		func(p ReviewCommentAddParams) (string, error) {
			if err := requireNonEmpty("review.comment.add", "repoId", p.RepoID, "path", p.Path); err != nil {
				return "", err
			}
			if err := validRefArg("branch", p.Branch); err != nil {
				return "", err
			}
			if err := validObjectID("at", p.At); err != nil {
				return "", err
			}
			if p.Range.Start < 1 || p.Range.End < p.Range.Start {
				return "", ipcerr.BadRequest("gitrpc: review.comment.add: range must satisfy 1 <= start <= end")
			}
			body = normalizeCommentBody(p.Body)
			if body == "" {
				return "", ipcerr.BadRequest("gitrpc: review.comment.add: body must not be empty")
			}
			if len(body) > MaxCommentBytes {
				return "", ipcerr.BadRequest("gitrpc: review.comment.add: body exceeds 8 KiB")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p ReviewCommentAddParams) (ReviewCommentAddResult, error) {
			comment, err := entry.AddComment(ctx, p.Branch, p.Path, p.At, p.Range, body)
			if err != nil {
				return ReviewCommentAddResult{}, mapDetailError(err)
			}
			return ReviewCommentAddResult{Comment: comment}, nil
		},
	)
}

func (r *Router) handleReviewCommentList(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "review.comment.list", params,
		func(p ReviewCommentListParams) (string, error) {
			if err := requireNonEmpty("review.comment.list", "repoId", p.RepoID); err != nil {
				return "", err
			}
			if err := validRefArg("branch", p.Branch); err != nil {
				return "", err
			}
			if p.At != "" {
				if err := validObjectID("at", p.At); err != nil {
					return "", err
				}
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p ReviewCommentListParams) (json.RawMessage, error) {
			result, err := entry.ListComments(ctx, p.Branch, p.At)
			if err != nil {
				return nil, mapDetailError(err)
			}

			// D17: unreachable in practice (MaxCommentBytes at 8 KiB needs hundreds of comments in one
			// session to cross MaxResultBytes) but "unreachable" is not "unhandled" — no tooLarge arm on
			// this result to degrade into, so this is an E_TOO_LARGE-shaped ipcerr instead.
			raw, merr := json.Marshal(result)
			if merr != nil {
				return nil, ipcerr.Internal(merr.Error())
			}
			if len(raw) > MaxResultBytes {
				return nil, ipcerr.New("E_TOO_LARGE", fmt.Sprintf("gitrpc: review.comment.list: result too large (%d comments)", len(result.Comments)))
			}
			return json.RawMessage(raw), nil
		},
	)
}

func (r *Router) handleReviewCommentRemove(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "review.comment.remove", params,
		func(p ReviewCommentRemoveParams) (string, error) {
			if err := requireNonEmpty("review.comment.remove", "repoId", p.RepoID); err != nil {
				return "", err
			}
			if err := validRefArg("branch", p.Branch); err != nil {
				return "", err
			}
			if p.ID <= 0 {
				return "", ipcerr.BadRequest("gitrpc: review.comment.remove: id must be positive")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p ReviewCommentRemoveParams) (ReviewCommentRemoveResult, error) {
			removed, err := entry.RemoveComment(ctx, p.Branch, p.ID)
			if err != nil {
				return ReviewCommentRemoveResult{}, mapDetailError(err)
			}
			return ReviewCommentRemoveResult{Removed: removed}, nil
		},
	)
}

func (r *Router) handleReviewCommentClear(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "review.comment.clear", params,
		func(p ReviewCommentClearParams) (string, error) {
			if err := requireNonEmpty("review.comment.clear", "repoId", p.RepoID); err != nil {
				return "", err
			}
			if err := validRefArg("branch", p.Branch); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p ReviewCommentClearParams) (ReviewCommentClearResult, error) {
			n, err := entry.ClearComments(ctx, p.Branch)
			if err != nil {
				return ReviewCommentClearResult{}, mapDetailError(err)
			}
			return ReviewCommentClearResult{Removed: n}, nil
		},
	)
}

func (r *Router) handleReviewCommentExport(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "review.comment.export", params,
		func(p ReviewCommentExportParams) (string, error) {
			if err := requireNonEmpty("review.comment.export", "repoId", p.RepoID); err != nil {
				return "", err
			}
			if err := validRefArg("branch", p.Branch); err != nil {
				return "", err
			}
			if p.At != "" {
				if err := validObjectID("at", p.At); err != nil {
					return "", err
				}
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p ReviewCommentExportParams) (json.RawMessage, error) {
			at, text, err := entry.ExportComments(ctx, p.Branch, p.At)
			if err != nil {
				return nil, mapDetailError(err)
			}
			result := ReviewCommentExportResult{At: at, Text: text}

			raw, merr := json.Marshal(result)
			if merr != nil {
				return nil, ipcerr.Internal(merr.Error())
			}
			if len(raw) > MaxResultBytes {
				return nil, ipcerr.New("E_TOO_LARGE", "gitrpc: review.comment.export: result too large")
			}
			return json.RawMessage(raw), nil
		},
	)
}
