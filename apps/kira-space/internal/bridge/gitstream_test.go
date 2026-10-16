package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
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

func isReadOnlyErr(err error) bool {
	var e *ipcerr.Error
	if !errors.As(err, &e) {
		return false
	}
	return e.Code == "E_READ_ONLY"
}

// --- guardRepoSettingsSet: the field-level restriction on repoSettings.set (finding C12-1). ---

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
			wrapped := guardRepoSettingsSet(spy.fn)

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
			wrapped := guardRepoSettingsSet(spy.fn)

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

// TestRepoSettingsSetTouchesRestrictedField_CoversEveryPatchField is C13-11's second forcing
// function: repoSettingsSetTouchesRestrictedField (gitstream.go) hard-codes which
// RepoSettingsPatchWire leaves are restricted, with nothing checking that list against the type's
// own actual field set — exactly the gap that let the original C12-1 bug happen (a new patch field
// silently inheriting "allowed" until someone thought to add it to the restricted list by hand).
// This sets exactly one field at a time (via reflection over the real struct, not a hand-maintained
// mirror of its field names) to a real, non-nil value, marshals a genuine RepoSettingsSetParams,
// and asserts repoSettingsSetTouchesRestrictedField's answer for it against an explicit expected
// map — so a field added, renamed or removed on RepoSettingsPatchWire with no matching update here
// (and, in the restricted direction, in repoSettingsSetTouchesRestrictedField itself) fails loudly.
func TestRepoSettingsSetTouchesRestrictedField_CoversEveryPatchField(t *testing.T) {
	// EVERY RepoSettingsPatchWire field must have an entry here — true (restricted) or false
	// (allowed) — checked by PRESENCE (`knownFields[name]`'s second, ok, return), never by the
	// zero-value default a plain `map[string]bool` would silently give an absent key. That
	// distinction is the entire point: a `restricted[name]` map with only the 4 restricted names
	// listed would let a brand-new field pass this test by pure coincidence whenever
	// repoSettingsSetTouchesRestrictedField ALSO (correctly, by omission) treats it as unrestricted
	// — both sides silently agreeing is exactly the undetected-gap failure mode C12-1 was, and
	// exactly what a first draft of this test (using a plain bool map, no `seen`/`ok` check) still
	// let through uncaught in testing.
	//
	// Mirrors gitstream.go's own repoSettingsSetTouchesRestrictedField doc comment: the two `true`
	// entries are write-only surface a compromised graph mount could otherwise stage (a prepare
	// script/base path; gitrpc refuses the script on every connection since P172, this guard is
	// defence in depth). PullStrategy/CheckoutAutoStash flipped to `false` in P67e (docs/v1.6/plans/
	// P67e-git-relax-read-only.md D4) — they configure operations this stream now admits, not
	// write-only surface. Every `false` entry is a per-repo graph/UI preference.
	knownFields := map[string]bool{
		"WorktreePrepareScript": true,
		"WorktreeBasePath":      true,
		"PullStrategy":          false,
		"CheckoutAutoStash":     false,
		"GraphPageSize":         false,
		"GraphScope":            false,
		"StashShowInGraph":      false,
		"StashIncludeUntracked": false,
		"ReviewBaseCandidates":  false,
		"GithubEnabled":         false,
	}

	patchType := reflect.TypeOf(gitrpc.RepoSettingsPatchWire{})
	if patchType.NumField() == 0 {
		t.Fatal("RepoSettingsPatchWire has zero fields -- reflection is almost certainly looking at the wrong type")
	}

	seen := map[string]bool{}
	for i := 0; i < patchType.NumField(); i++ {
		field := patchType.Field(i)
		seen[field.Name] = true

		want, ok := knownFields[field.Name]
		if !ok {
			t.Errorf(
				"field %s: no entry in this test's own knownFields map -- classify it explicitly here (true/false) AND, if restricted, add it to repoSettingsSetTouchesRestrictedField itself; do not let it default to \"allowed\"",
				field.Name,
			)
			continue
		}

		if field.Tag.Get("json") == "" {
			t.Errorf("field %s: no json tag -- every RepoSettingsPatchWire leaf must round-trip over the wire", field.Name)
			continue
		}

		var patch gitrpc.RepoSettingsPatchWire
		fv := reflect.ValueOf(&patch).Elem().Field(i)
		if fv.Kind() != reflect.Pointer {
			t.Errorf("field %s: kind %s, want a pointer -- every RepoSettingsPatchWire leaf is optional", field.Name, fv.Kind())
			continue
		}
		fv.Set(reflect.New(fv.Type().Elem())) // a real, non-nil, zero-valued leaf.

		raw, err := json.Marshal(gitrpc.RepoSettingsSetParams{RepoID: "r1", Patch: patch})
		if err != nil {
			t.Fatalf("field %s: marshal: %v", field.Name, err)
		}

		got := repoSettingsSetTouchesRestrictedField(raw)
		if got != want {
			t.Errorf(
				"field %s: repoSettingsSetTouchesRestrictedField = %v, want %v (per this test's own knownFields classification)",
				field.Name, got, want,
			)
		}
	}

	for name := range knownFields {
		if !seen[name] {
			t.Errorf("field %q in this test's own knownFields map no longer exists on RepoSettingsPatchWire -- update the map", name)
		}
	}
}
