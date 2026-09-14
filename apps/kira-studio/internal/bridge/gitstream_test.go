package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
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

func isReadOnlyErr(err error) bool {
	var e *ipcerr.Error
	if !errors.As(err, &e) {
		return false
	}
	return e.Code == "E_READ_ONLY"
}

// TestReadOnlyRequest_AllowlistedMethodsReachInnerHandler is one half of the safety-boundary
// contract: every method the allowlist admits must actually be served, not silently swallowed by
// the wrapper — a leak in the other direction (allowlisted but never dispatched) would just look
// like every read is broken, but it is still a correctness bug this test is the one place to catch.
func TestReadOnlyRequest_AllowlistedMethodsReachInnerHandler(t *testing.T) {
	for method := range readOnlyMethods {
		t.Run(method, func(t *testing.T) {
			spy := &spyRequest{}
			wrapped := readOnlyRequest(spy.fn)

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

// TestReadOnlyRequest_WriteMethodsAreRefused is the phase's one load-bearing test (§11, §15 point
// 7's "backstop check ... nothing else in this phase matters until it is"). Every method here
// genuinely writes the repository (§4.1's table) and MUST be refused with E_READ_ONLY, and — the
// part a weaker test could miss — MUST NEVER reach the inner handler at all. A wrapper that
// returned E_READ_ONLY on some other code path while still calling next underneath (e.g. to log
// it, or by accident) would pass a test that only checks the returned error; the spy's own call
// count is what catches that.
//
// C11 §3.4: the four review.* methods this table used to list moved out. review.mark and
// review.comment.add/remove/clear only ever write review.db (C11 §3.1) and are now allowlisted,
// covered by TestReadOnlyRequest_AllowlistedMethodsReachInnerHandler below; review.session.save
// moved to TestReadOnlyRequest_HostAnsweredMethodsAreRefused since it is refused because Go has no
// handler for it, not because it is a write.
func TestReadOnlyRequest_WriteMethodsAreRefused(t *testing.T) {
	writeMethods := []string{
		"op.run", "remote.run", "remote.cancel", "undo.run",
		"worktree.prepare", "worktree.cancelPrepare",
		"stack.restack", "stack.cancelRestack",
		"credential.provide", "editor.resolveConflict", "settings.setGitPath",
	}
	for _, method := range writeMethods {
		t.Run(method, func(t *testing.T) {
			spy := &spyRequest{}
			wrapped := readOnlyRequest(spy.fn)

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

// TestReadOnlyRequest_HostAnsweredMethodsAreRefused covers the methods this stream refuses for a
// different reason than TestReadOnlyRequest_WriteMethodsAreRefused's table: the Go router has no
// case for any of these at all (C11 §3.3) — review.session.save/.load resume the extension's own
// context.workspaceState and never reach this server even when it exists; review.open and
// editor.openRangeDiff are answered host-side (§8.2). Refusing them here is defence in depth, not
// the write boundary itself, but the property under test — never reaching the inner handler — is
// the same one that matters.
func TestReadOnlyRequest_HostAnsweredMethodsAreRefused(t *testing.T) {
	hostAnsweredMethods := []string{
		"review.session.save", "review.session.load", "review.open", "editor.openRangeDiff",
	}
	for _, method := range hostAnsweredMethods {
		t.Run(method, func(t *testing.T) {
			spy := &spyRequest{}
			wrapped := readOnlyRequest(spy.fn)

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

// TestReadOnlyRequest_UnknownMethodIsRefused pins the allowlist-not-denylist property: a method
// this file has simply never heard of (e.g. one a future contract version adds) must be refused by
// default, not admitted because it isn't on any explicit deny list.
func TestReadOnlyRequest_UnknownMethodIsRefused(t *testing.T) {
	spy := &spyRequest{}
	wrapped := readOnlyRequest(spy.fn)

	_, err := wrapped(context.Background(), "some.futureMethod", json.RawMessage(`{}`))

	if !isReadOnlyErr(err) {
		t.Fatalf("got error %v, want an ipcerr.Error with code E_READ_ONLY", err)
	}
	if len(spy.called) != 0 {
		t.Fatalf("inner handler was called (%v) for an unknown method", spy.called)
	}
}

// --- readOnlyStream: the same three properties, over the one streaming method. ---

type spyStream struct {
	called []string
}

func (s *spyStream) fn(_ context.Context, method string, _ json.RawMessage, _ func(payload any, blob []byte) error) error {
	s.called = append(s.called, method)
	return nil
}

func TestReadOnlyStream_GraphStreamReachesInnerHandler(t *testing.T) {
	spy := &spyStream{}
	wrapped := readOnlyStream(spy.fn)

	err := wrapped(context.Background(), "graph.stream", json.RawMessage(`{}`), func(any, []byte) error { return nil })

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(spy.called) != 1 || spy.called[0] != "graph.stream" {
		t.Fatalf("inner handler called with %v, want exactly one call with graph.stream", spy.called)
	}
}

func TestReadOnlyStream_UnknownStreamMethodIsRefused(t *testing.T) {
	spy := &spyStream{}
	wrapped := readOnlyStream(spy.fn)

	err := wrapped(context.Background(), "review.stream", json.RawMessage(`{}`), func(any, []byte) error { return nil })

	if !isReadOnlyErr(err) {
		t.Fatalf("got error %v, want an ipcerr.Error with code E_READ_ONLY", err)
	}
	if len(spy.called) != 0 {
		t.Fatalf("inner handler was called (%v) for a non-allowlisted stream method", spy.called)
	}
}

// --- readOnlyRepoSettingsSet: the field-level restriction on top of repoSettings.set's own
// method-level allowlisting (finding C12-1). ---

// TestReadOnlyRepoSettingsSet_AllowedFieldsReachInnerHandler pins the non-regression half: a patch
// touching only fields that were always meant to work over this stream (graph paging/scope here,
// standing in for the rest — StashShowInGraph/StashIncludeUntracked/ReviewBaseCandidates/LogLevel/
// GithubEnabled follow the identical shape) must still reach the real handler unchanged.
func TestReadOnlyRepoSettingsSet_AllowedFieldsReachInnerHandler(t *testing.T) {
	spy := &spyRequest{}
	wrapped := readOnlyRepoSettingsSet(readOnlyRequest(spy.fn))

	params := json.RawMessage(`{"repoId":"r1","patch":{"kiraVersion.graph.pageSize":50,"kiraVersion.graph.scope":"local"}}`)
	result, err := wrapped(context.Background(), "repoSettings.set", params)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "inner-result" {
		t.Fatalf("got result %v, want the inner handler's own result", result)
	}
	if len(spy.called) != 1 || spy.called[0] != "repoSettings.set" {
		t.Fatalf("inner handler called with %v, want exactly one call", spy.called)
	}
}

// TestReadOnlyRepoSettingsSet_RestrictedFieldsAreRefused is this finding's load-bearing test: a
// patch carrying any of the four write-only-surface fields — even alongside otherwise-allowed
// fields — must be refused with E_READ_ONLY and must never reach the inner handler.
func TestReadOnlyRepoSettingsSet_RestrictedFieldsAreRefused(t *testing.T) {
	cases := []struct {
		name   string
		params string
	}{
		{
			name:   "WorktreePrepareScript alongside an allowed field",
			params: `{"repoId":"r1","patch":{"kiraVersion.graph.pageSize":50,"kiraVersion.worktree.prepareScript":"rm -rf /"}}`,
		},
		{
			name:   "WorktreeBasePath",
			params: `{"repoId":"r1","patch":{"kiraVersion.worktree.basePath":"/tmp/worktrees"}}`,
		},
		{
			name:   "PullStrategy",
			params: `{"repoId":"r1","patch":{"kiraVersion.pull.strategy":"rebase"}}`,
		},
		{
			name:   "CheckoutAutoStash",
			params: `{"repoId":"r1","patch":{"kiraVersion.checkout.autoStash":false}}`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			spy := &spyRequest{}
			wrapped := readOnlyRepoSettingsSet(readOnlyRequest(spy.fn))

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
