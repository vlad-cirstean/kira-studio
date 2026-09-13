package gitrpc

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
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
	var p ReviewCommentAddParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.add: invalid params")
	}
	if p.RepoID == "" || p.Path == "" {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.add: repoId and path are required")
	}
	if err := validRefArg("branch", p.Branch); err != nil {
		return nil, err
	}
	if err := validObjectID("at", p.At); err != nil {
		return nil, err
	}
	if p.Range.Start < 1 || p.Range.End < p.Range.Start {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.add: range must satisfy 1 <= start <= end")
	}
	body := normalizeCommentBody(p.Body)
	if body == "" {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.add: body must not be empty")
	}
	if len(body) > MaxCommentBytes {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.add: body exceeds 8 KiB")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	comment, err := entry.AddComment(ctx, p.Branch, p.Path, p.At, p.Range, body)
	if err != nil {
		return nil, mapDetailError(err)
	}
	return ReviewCommentAddResult{Comment: comment}, nil
}

func (r *Router) handleReviewCommentList(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p ReviewCommentListParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.list: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.list: repoId is required")
	}
	if err := validRefArg("branch", p.Branch); err != nil {
		return nil, err
	}
	if p.At != "" {
		if err := validObjectID("at", p.At); err != nil {
			return nil, err
		}
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
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
}

func (r *Router) handleReviewCommentRemove(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p ReviewCommentRemoveParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.remove: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.remove: repoId is required")
	}
	if err := validRefArg("branch", p.Branch); err != nil {
		return nil, err
	}
	if p.ID <= 0 {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.remove: id must be positive")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	removed, err := entry.RemoveComment(ctx, p.Branch, p.ID)
	if err != nil {
		return nil, mapDetailError(err)
	}
	return ReviewCommentRemoveResult{Removed: removed}, nil
}

func (r *Router) handleReviewCommentClear(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p ReviewCommentClearParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.clear: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.clear: repoId is required")
	}
	if err := validRefArg("branch", p.Branch); err != nil {
		return nil, err
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	n, err := entry.ClearComments(ctx, p.Branch)
	if err != nil {
		return nil, mapDetailError(err)
	}
	return ReviewCommentClearResult{Removed: n}, nil
}

func (r *Router) handleReviewCommentExport(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p ReviewCommentExportParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.export: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: review.comment.export: repoId is required")
	}
	if err := validRefArg("branch", p.Branch); err != nil {
		return nil, err
	}
	if p.At != "" {
		if err := validObjectID("at", p.At); err != nil {
			return nil, err
		}
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
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
}
