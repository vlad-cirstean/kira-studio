package gitrpc

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// validRefArg is D8's own guard, applied at the one entrance a client-supplied ref name reaches an
// argv: non-empty, no leading "-". Resolves F6 — `merge-base` (unlike log/rev-list's own two-dot
// token) takes its two revisions as separate argv tokens, so a base beginning with "-" would be
// read as a merge-base flag of its own rather than a revision (`--independent` exits 0 with a sha,
// which this resolver would misread as "shares history"). Does not duplicate validateRefName's
// client-side job (`@{` shorthand and the rest stay git's own problem when the argv runs).
func validRefArg(field, value string) error {
	if value == "" {
		return ipcerr.BadRequest("gitrpc: " + field + " must not be empty")
	}
	if strings.HasPrefix(value, "-") {
		return ipcerr.BadRequest("gitrpc: " + field + " must not begin with '-'")
	}
	return nil
}

func (r *Router) handleReviewResolveBase(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p ReviewResolveBaseParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: review.resolveBase: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: review.resolveBase: repoId is required")
	}
	if err := validRefArg("branch", p.Branch); err != nil {
		return nil, err
	}
	if p.Base != nil {
		if err := validRefArg("base", *p.Base); err != nil {
			return nil, err
		}
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.ResolveReviewBase(ctx, p.Branch, p.Base, p.BaseCandidates)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}
