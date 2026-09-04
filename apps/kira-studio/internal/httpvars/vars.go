// Package httpvars is P5's Go-side half: collection variables, top-level named environments, the
// gated secret reveal, and stage 2 of the two-stage {{name}} substitution (D6) — the half that
// resolves a secret, strictly after bridge/http.go's op.SetCommand call (F3), so a decrypted
// credential never reaches op_log.command.
//
// Http-scoped Go, beside internal/httpclient and internal/postman (D19) — imports
// internal/storage/repos, internal/secrets and internal/localauth, and deliberately not
// internal/connections (D8: importing Studio's connections package from here would be exactly the
// Studio<->Http coupling docs/v1.2/SPEC.md's module-boundary section exists to prevent) and not
// Wails.
package httpvars

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/localauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// Authorizer is connections.Service's own seam, redeclared here for the identical reason: a test
// can inject a fake outcome sequence with no real clock or OS-auth probe wired through.
// *localauth.Authorizer satisfies this structurally.
type Authorizer interface {
	Authorize(reason string, confirmed bool) (localauth.Outcome, error)
}

// Deps is everything the service needs. Cipher is carried for parity with New's own signature and
// with connections.Deps' identical field — every method here that actually touches secret_value
// goes through Repo (which holds its own copy of the same Cipher), not this one directly.
type Deps struct {
	Repo   *repos.VariablesRepo
	Cipher *secrets.Cipher
	Auth   Authorizer
}

// Service is the Go analogue of a P5-scoped connections.Service: the bridge (bridge/variables.go)
// wraps every method here in a typed-struct arg and an ipcerr translation.
type Service struct {
	deps Deps
}

// New wires httpvars against the SAME *localauth.Authorizer instance connections.Service already
// uses (D8) — main.go constructs exactly one Authorizer and passes it to both, which is what makes
// the 5-minute reveal grace genuinely shared between a connection-password reveal and a variable
// reveal.
func New(repo *repos.VariablesRepo, cipher *secrets.Cipher, auth *localauth.Authorizer) *Service {
	return &Service{deps: Deps{Repo: repo, Cipher: cipher, Auth: auth}}
}
