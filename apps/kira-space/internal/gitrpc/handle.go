package gitrpc

import (
	"context"
	"encoding/json"
	"strings"

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

// handleCall is handleRepoCall's own sibling for a handler with no repo to resolve (P107 I2-13) —
// credential.provide and settings.* (repoSettings.get/set, settings.setGitPath) validate params
// and call straight through, with no RepoEntry lookup in between. validate may be nil for a
// handler with no required-field check of its own (settings.setGitPath: "" is a valid, meaningful
// value — clear the override).
func handleCall[P, R any](
	op string,
	params json.RawMessage,
	validate func(p P) error,
	call func(p P) (R, error),
) (any, error) {
	var p P
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: " + op + ": invalid params")
	}
	if validate != nil {
		if err := validate(p); err != nil {
			return nil, err
		}
	}
	return call(p)
}

// requireNonEmpty replaces 43 handlers' own hand-rolled "if a == \"\" || b == \"\" { return
// ipcerr.BadRequest(op + \": a and b are required\") }" check (P107 I2-13). namesAndValues
// alternates a field's wire name and its value ("repoId", p.RepoID, "sha", p.SHA, ...) — every
// call site here is a fixed literal, so there is no real risk of mispairing. The doc's own stated
// `fields map[string]string` does not fit: every existing message lists its fields in a fixed,
// meaningful order ("repoId, sha and branch are required"), and Go map iteration order is random.
func requireNonEmpty(op string, namesAndValues ...string) error {
	var missing []string
	for i := 0; i+1 < len(namesAndValues); i += 2 {
		if namesAndValues[i+1] == "" {
			missing = append(missing, namesAndValues[i])
		}
	}
	if len(missing) == 0 {
		return nil
	}
	verb := "is"
	if len(missing) > 1 {
		verb = "are"
	}
	return ipcerr.BadRequest("gitrpc: " + op + ": " + joinRequired(missing) + " " + verb + " required")
}

// joinRequired renders ["repoId", "sha", "branch"] as "repoId, sha and branch" — the exact join
// style every hand-rolled message here already used.
func joinRequired(names []string) string {
	if len(names) == 1 {
		return names[0]
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}
