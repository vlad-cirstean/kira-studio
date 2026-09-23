package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// handleRepoCall is the thin-dispatch shape refs.go, stack.go and detail.go's own read handlers
// each rebuilt per op (T2-12): decode params, resolve c's held RepoEntry, call one RepoEntry
// method, return the result. Each op differs in more than param/method/result type — required-
// field rules vary (a bare repoId check vs. preflight.checkout's target+mode, commit.detail's
// sha+validRefArg) and so does the error mapper (mapGitError vs. detail.go's own mapDetailError,
// for the four queries whose closed error vocabulary needs its own BadRequest mapping) — so those
// two live in the caller's own closures rather than being generic parameters no single shape would
// fit: resolve both validates and extracts repoId in one step (the two were never separable — a
// missing repoId IS the validation failure), and call returns its own already wire-mapped error
// exactly as its non-generic predecessor did.
func handleRepoCall[P, R any](
	ctx context.Context,
	c *gitsession.Conn,
	op string,
	params json.RawMessage,
	resolve func(p P) (repoID string, err error),
	call func(ctx context.Context, entry *gitsession.RepoEntry, p P) (R, error),
) (any, error) {
	var p P
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: " + op + ": invalid params")
	}
	repoID, err := resolve(p)
	if err != nil {
		return nil, err
	}
	entry, err := entryFor(c, repoID)
	if err != nil {
		return nil, err
	}
	return call(ctx, entry, p)
}
