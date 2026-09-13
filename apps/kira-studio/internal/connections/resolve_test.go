package connections

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// TestResolveFromInputPrefersURIEmbeddedPassword pins P2 R2's fix to the "Test connection" path:
// a password typed directly into the URI (e.g. after retyping the whole URI for a different host)
// must be what actually gets tested, not a stale in.Password left over from before the edit — the
// old code unconditionally injected in.Password over whatever the URI already carried, silently
// discarding a freshly typed password (and, since it travelled with a URI now pointing at a
// different host, silently testing the *old* host's credentials against the new one instead).
func TestResolveFromInputPrefersURIEmbeddedPassword(t *testing.T) {
	stale := "old-host-password"
	in := Input{
		ConnectionFields: model.ConnectionFields{
			Name: "test", Kind: "postgres", Color: "blue", Mode: "uri",
			URI: strPtr("postgresql://u:newpass@new-host:5432/db"), Options: map[string]any{},
		},
		Password: &stale,
	}
	r := resolveFromInput(in)
	if r.config.URI == nil || *r.config.URI != "postgresql://u:newpass@new-host:5432/db" {
		t.Fatalf("resolved uri = %v, want the URI's own inline password preserved", r.config.URI)
	}
	if r.config.Password == nil || *r.config.Password != "newpass" {
		t.Fatalf("resolved password = %v, want newpass", derefOrNil(r.config.Password))
	}
}

// TestResolveFromInputFallsBackToInputPasswordWhenURIHasNone is the companion case: a URI with no
// userinfo password at all (the normal shape once D7 strips one out for display) still falls back
// to in.Password, so an edit that never touches the URI's credentials keeps testing with whatever
// password the dialog already knows about.
func TestResolveFromInputFallsBackToInputPasswordWhenURIHasNone(t *testing.T) {
	known := "known-password"
	in := Input{
		ConnectionFields: model.ConnectionFields{
			Name: "test", Kind: "postgres", Color: "blue", Mode: "uri",
			URI: strPtr("postgresql://u@h:5432/db"), Options: map[string]any{},
		},
		Password: &known,
	}
	r := resolveFromInput(in)
	if r.config.URI == nil || *r.config.URI != "postgresql://u:known-password@h:5432/db" {
		t.Fatalf("resolved uri = %v, want in.Password injected", r.config.URI)
	}
	if r.config.Password == nil || *r.config.Password != known {
		t.Fatalf("resolved password = %v, want %q", derefOrNil(r.config.Password), known)
	}
}

// TestResolveFromInputMintsAUniqueIDPerCall is the P21 round 2 architecture/security finding 9
// regression: the id used to be the literal "test" every single call — with two workbench windows
// open, two concurrent Test connection presses on two different drafts both used that same key,
// and Preconnect.Supervisor.Start kills anything already tracked under a key it is given, so the
// second Start SIGTERMed the first's still-settling pre-connect script (and the first Test's own
// deferred Stop could kill the second's), producing a spurious failure against a script that was
// fine. A fresh id per call makes two concurrent Test calls independent.
func TestResolveFromInputMintsAUniqueIDPerCall(t *testing.T) {
	in := Input{
		ConnectionFields: model.ConnectionFields{
			Name: "a", Kind: "postgres", Color: "blue", Mode: "fields", Options: map[string]any{},
		},
	}
	first := resolveFromInput(in)
	second := resolveFromInput(in)
	if first.config.ID == "test" || second.config.ID == "test" {
		t.Fatalf("resolveFromInput still mints the literal \"test\" id: first=%q second=%q", first.config.ID, second.config.ID)
	}
	if first.config.ID == second.config.ID {
		t.Fatalf("two resolveFromInput calls minted the same id (%q) — two concurrent Test calls would still collide on Preconnect's key", first.config.ID)
	}
}
