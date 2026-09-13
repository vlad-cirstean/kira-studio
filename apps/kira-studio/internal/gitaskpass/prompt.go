// Package gitaskpass is the credential broker + GIT_ASKPASS/SSH_ASKPASS shim over its own private
// unix socket (SPEC's own package table; docs/v1.3/plans/G7's D7-D10). It imports stdlib only —
// gitsession supplies the one production Prompter (its Conn's own credential waiters), which is
// what keeps this package free of any dependency on gitsession, bridge or rpcstream.
package gitaskpass

import (
	"context"
	"regexp"
)

// Request is one prompt from git's own askpass protocol — the Go analogue of upstream's
// CredentialPrompt request shape. Never logged, never persisted, on either side of this package's
// boundary: Prompt can itself carry a username the user just typed (probe P1's second prompt).
type Request struct {
	RepoID string
	Prompt string
	Masked bool
}

// Prompter is supplied by gitsession, backed by one Conn's own credential waiters (D20). Ask must
// return ("", false) for every not-answered outcome — dismissed, disconnected, timed out,
// cancelled — and must never block past ctx.
type Prompter interface {
	Ask(ctx context.Context, req Request) (string, bool)
}

// usernamePromptRe matches git's own "Username for '<url>': " shape — the one askpass prompt that
// is not itself a secret.
var usernamePromptRe = regexp.MustCompile(`(?i)^Username`)

// DeriveMasked reports whether prompt should be masked in the relayed UI. Ported verbatim from
// upstream's own rule: everything unrecognised is masked, because showing an unrecognised secret
// in the clear is the worse of the two failure modes — the set of prompt shapes git can produce is
// not closed (probe P1).
func DeriveMasked(prompt string) bool {
	return !usernamePromptRe.MatchString(prompt)
}
