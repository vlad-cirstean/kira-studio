package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// spyRequest wraps a requestFn, recording every method it was actually called with — the
// mechanism that pins "never calls the inner handler" for a refused write, not merely "returns the
// right error" (docs/v1.5/plans/C10-git-graph-native.md §11's own requirement).
type spyRequest struct {
	called []string
}

func (s *spyRequest) fn(_ context.Context, method string, _ json.RawMessage) (any, error) {
	s.called = append(s.called, method)
	return "inner-result", nil
}

// writeMethods and hostAnsweredMethods are the explicit, commented "must stay refused" lists
// TestAllowedRequest_WriteMethodsAreRefused/TestAllowedRequest_HostAnsweredMethodsAreRefused
// exercise below — hoisted to package scope (rather than declared inline in each test) so
// TestGitrpcDispatch_EveryMethodIsClassified (gitrpc_dispatch_coverage_test.go, C13-11) can check
// its own derived method set against the exact same two lists, with nothing to fall out of sync.
//
// P67e shrank this to the four methods that genuinely stay refused (docs/v1.6/plans/
// P67e-git-relax-read-only.md D1): worktree.prepare/worktree.cancelPrepare (arbitrary shell
// execution with no approval gate anywhere in this codebase) and settings.setGitPath (owned by
// this app's own Settings dialog) are dispatched by Router.ForConn but excluded from
// allowedMethods on purpose; editor.resolveConflict is refused here too even though Router.ForConn
// has no case for it at all — this app has no merge editor, the user's own stated carve-out, and
// pinning the refusal at this layer is defence in depth beside hostHandlers.ts's own throw.
// worktree.openWindow stays refused only at layer two (gitstream_test.go has never listed it —
// hostHandlers.ts throws locally and Router.ForConn never sees it either way).
var writeMethods = []string{
	"worktree.prepare", "worktree.cancelPrepare", "settings.setGitPath", "editor.resolveConflict",
}

var hostAnsweredMethods = []string{
	"review.session.save", "review.session.load", "review.open", "editor.openRangeDiff",
}

func isReadOnlyErr(err error) bool {
	var e *ipcerr.Error
	if !errors.As(err, &e) {
		return false
	}
	return e.Code == "E_READ_ONLY"
}

// TestAllowedRequest_AllowlistedMethodsReachInnerHandler is one half of the safety-boundary
// contract: every method the allowlist admits must actually be served, not silently swallowed by
// the wrapper — a leak in the other direction (allowlisted but never dispatched) would just look
// like every read is broken, but it is still a correctness bug this test is the one place to catch.
func TestAllowedRequest_AllowlistedMethodsReachInnerHandler(t *testing.T) {
	for method := range allowedMethods {
		t.Run(method, func(t *testing.T) {
			spy := &spyRequest{}
			wrapped := allowedRequest(spy.fn)

			result, err := wrapped(context.Background(), method, json.RawMessage(`{}`))

			if err != nil {
				t.Fatalf("method %q: unexpected error: %v", method, err)
			}
			if result != "inner-result" {
				t.Fatalf("method %q: got result %v, want the inner handler's own result", method, result)
			}
			if len(spy.called) != 1 || spy.called[0] != method {
				t.Fatalf("method %q: inner handler called with %v, want exactly one call with this method", method, spy.called)
			}
		})
	}
}

// TestAllowedRequest_WriteMethodsAreRefused is the one load-bearing test for what still stays
// refused after P67e (docs/v1.6/plans/P67e-git-relax-read-only.md D1): every method here needs
// something this app genuinely does not have (an approval gate for shell execution, or a merge
// editor) and MUST be refused with E_READ_ONLY, and — the part a weaker test could miss — MUST
// NEVER reach the inner handler at all. A wrapper that returned E_READ_ONLY on some other code
// path while still calling next underneath (e.g. to log it, or by accident) would pass a test that
// only checks the returned error; the spy's own call count is what catches that.
func TestAllowedRequest_WriteMethodsAreRefused(t *testing.T) {
	for _, method := range writeMethods {
		t.Run(method, func(t *testing.T) {
			spy := &spyRequest{}
			wrapped := allowedRequest(spy.fn)

			_, err := wrapped(context.Background(), method, json.RawMessage(`{}`))

			if err == nil {
				t.Fatalf("method %q: got no error, want E_READ_ONLY", method)
			}
			if !isReadOnlyErr(err) {
				t.Fatalf("method %q: got error %v, want an ipcerr.Error with code E_READ_ONLY", method, err)
			}
			if len(spy.called) != 0 {
				t.Fatalf("method %q: inner handler was called (%v) — a write must never reach it", method, spy.called)
			}
		})
	}
}

// TestAllowedRequest_HostAnsweredMethodsAreRefused covers the methods this stream refuses for a
// different reason than TestAllowedRequest_WriteMethodsAreRefused's table: the Go router has no
// case for any of these at all (C11 §3.3) — review.session.save/.load resume the extension's own
// context.workspaceState and never reach this server even when it exists; review.open and
// editor.openRangeDiff are answered host-side (§8.2). Refusing them here is defence in depth, not
// the write boundary itself, but the property under test — never reaching the inner handler — is
// the same one that matters.
func TestAllowedRequest_HostAnsweredMethodsAreRefused(t *testing.T) {
	for _, method := range hostAnsweredMethods {
		t.Run(method, func(t *testing.T) {
			spy := &spyRequest{}
			wrapped := allowedRequest(spy.fn)

			_, err := wrapped(context.Background(), method, json.RawMessage(`{}`))

			if err == nil {
				t.Fatalf("method %q: got no error, want E_READ_ONLY", method)
			}
			if !isReadOnlyErr(err) {
				t.Fatalf("method %q: got error %v, want an ipcerr.Error with code E_READ_ONLY", method, err)
			}
			if len(spy.called) != 0 {
				t.Fatalf("method %q: inner handler was called (%v) — a host-answered method must never reach it", method, spy.called)
			}
		})
	}
}

// TestAllowedRequest_UnknownMethodIsRefused pins the allowlist-not-denylist property: a method
// this file has simply never heard of (e.g. one a future contract version adds) must be refused by
// default, not admitted because it isn't on any explicit deny list.
func TestAllowedRequest_UnknownMethodIsRefused(t *testing.T) {
	spy := &spyRequest{}
	wrapped := allowedRequest(spy.fn)

	_, err := wrapped(context.Background(), "some.futureMethod", json.RawMessage(`{}`))

	if !isReadOnlyErr(err) {
		t.Fatalf("got error %v, want an ipcerr.Error with code E_READ_ONLY", err)
	}
	if len(spy.called) != 0 {
		t.Fatalf("inner handler was called (%v) for an unknown method", spy.called)
	}
}

// --- allowedStream: the same three properties, over the one streaming method. ---

type spyStream struct {
	called []string
}

func (s *spyStream) fn(_ context.Context, method string, _ json.RawMessage, _ func(payload any, blob []byte) error) error {
	s.called = append(s.called, method)
	return nil
}

func TestAllowedStream_GraphStreamReachesInnerHandler(t *testing.T) {
	spy := &spyStream{}
	wrapped := allowedStream(spy.fn)

	err := wrapped(context.Background(), "graph.stream", json.RawMessage(`{}`), func(any, []byte) error { return nil })

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(spy.called) != 1 || spy.called[0] != "graph.stream" {
		t.Fatalf("inner handler called with %v, want exactly one call with graph.stream", spy.called)
	}
}

func TestAllowedStream_UnknownStreamMethodIsRefused(t *testing.T) {
	spy := &spyStream{}
	wrapped := allowedStream(spy.fn)

	err := wrapped(context.Background(), "review.stream", json.RawMessage(`{}`), func(any, []byte) error { return nil })

	if !isReadOnlyErr(err) {
		t.Fatalf("got error %v, want an ipcerr.Error with code E_READ_ONLY", err)
	}
	if len(spy.called) != 0 {
		t.Fatalf("inner handler was called (%v) for a non-allowlisted stream method", spy.called)
	}
}

// --- guardRepoSettingsSet: the field-level restriction on top of repoSettings.set's own
// method-level allowlisting (finding C12-1). ---

// TestGuardRepoSettingsSet_AllowedFieldsReachInnerHandler pins the non-regression half: a patch
// touching only fields that were always meant to work over this stream (graph paging/scope, and —
// since P67e — PullStrategy/CheckoutAutoStash, the settings for operations this stream now admits)
// must still reach the real handler unchanged.
func TestGuardRepoSettingsSet_AllowedFieldsReachInnerHandler(t *testing.T) {
	cases := []struct {
		name   string
		params string
	}{
		{
			name:   "graph paging/scope",
			params: `{"repoId":"r1","patch":{"kiraSpace.graph.pageSize":50,"kiraSpace.graph.scope":"local"}}`,
		},
		{
			name:   "PullStrategy",
			params: `{"repoId":"r1","patch":{"kiraSpace.pull.strategy":"rebase"}}`,
		},
		{
			name:   "CheckoutAutoStash",
			params: `{"repoId":"r1","patch":{"kiraSpace.checkout.autoStash":false}}`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			spy := &spyRequest{}
			wrapped := guardRepoSettingsSet(allowedRequest(spy.fn))

			result, err := wrapped(context.Background(), "repoSettings.set", json.RawMessage(tc.params))

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result != "inner-result" {
				t.Fatalf("got result %v, want the inner handler's own result", result)
			}
			if len(spy.called) != 1 || spy.called[0] != "repoSettings.set" {
				t.Fatalf("inner handler called with %v, want exactly one call", spy.called)
			}
		})
	}
}

// TestGuardRepoSettingsSet_RestrictedFieldsAreRefused is this stream's own load-bearing test: a
// patch carrying either of the two write-only-surface fields — even alongside otherwise-allowed
// fields — must be refused with E_READ_ONLY and must never reach the inner handler.
func TestGuardRepoSettingsSet_RestrictedFieldsAreRefused(t *testing.T) {
	cases := []struct {
		name   string
		params string
	}{
		{
			name:   "WorktreePrepareScript alongside an allowed field",
			params: `{"repoId":"r1","patch":{"kiraSpace.graph.pageSize":50,"kiraSpace.worktree.prepareScript":"rm -rf /"}}`,
		},
		{
			name:   "WorktreeBasePath",
			params: `{"repoId":"r1","patch":{"kiraSpace.worktree.basePath":"/tmp/worktrees"}}`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			spy := &spyRequest{}
			wrapped := guardRepoSettingsSet(allowedRequest(spy.fn))

			_, err := wrapped(context.Background(), "repoSettings.set", json.RawMessage(tc.params))

			if err == nil {
				t.Fatalf("got no error, want E_READ_ONLY")
			}
			if !isReadOnlyErr(err) {
				t.Fatalf("got error %v, want an ipcerr.Error with code E_READ_ONLY", err)
			}
			if len(spy.called) != 0 {
				t.Fatalf("inner handler was called (%v) — a restricted field must never reach it", spy.called)
			}
		})
	}
}
