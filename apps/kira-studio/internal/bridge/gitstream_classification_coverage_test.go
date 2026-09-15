package bridge

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
)

// TestGitrpcDispatch_EveryMethodIsClassified is C13-11: allowedMethods/allowedStreamMethods
// (gitstream.go) plus writeMethods/hostAnsweredMethods (gitstream_test.go, hoisted to package
// scope for exactly this reason) are FOUR independently-maintained lists, and nothing before this
// test ever checked they actually cover every method internal/gitrpc/handlers.go's Router.ForConn
// dispatches. A new gitrpc method added with no corresponding entry in any of the four would
// silently inherit this stream's default-refuse behaviour (safe) but with no signal at all that a
// classification decision was even needed — exactly the gap that let the original C12-1 bug happen
// for repoSettings.set's own restricted fields. Running this once, unfixed, is in fact what found
// the original preflightMethods gap in the first place: every preflight.*/remote.*Preflight method
// was refused correctly (default-deny) but had never been pinned as a deliberate decision anywhere
// a test could catch its absence — P67e (docs/v1.6/plans/P67e-git-relax-read-only.md D2/D3)
// resolved that by admitting every preflight onto allowedMethods, alongside the write it stages, so
// there is no longer a separate "must stay refused" preflight table for this test to fold in.
//
// ForConn's dispatch table is a plain `switch method { case "...": ... }` inside a func literal,
// not a data structure reflection can enumerate — so this derives the REAL case set the only way
// available short of a go/analysis pass: parses every non-test .go file under internal/gitrpc/ (not
// one hard-coded file — a dispatch switch that moves to, or is added in, a different file in that
// package must still be found) and walks every switch statement whose tag is the identifier
// `method`, collecting every case's string literal(s). Ignores the `default` clause (its
// CaseClause.List is nil) and any switch with a different tag (there is only one shape of dispatch
// switch in this package today, but the walk does not assume that).
func TestGitrpcDispatch_EveryMethodIsClassified(t *testing.T) {
	dispatched := dispatchedGitrpcMethods(t)
	// A floor, not just "> 0": both switches this walk finds today live in handlers.go, so a change
	// that moves or adds one to a different file in the package would still leave len(dispatched) >
	// 0 (the other switch alone) — silently finding FEWER methods, with every one of a moved/added
	// switch's own methods then unclassified with zero test signal, exactly the gap this test exists
	// to close. 50 sits comfortably under the ~55 methods Router.ForConn dispatches today (gitstream.go's
	// own doc comment), so a genuine drop below it fails loudly instead of passing vacuously.
	const minDispatchedMethods = 50
	if len(dispatched) < minDispatchedMethods {
		t.Fatalf("derived only %d dispatched methods from every .go file in internal/gitrpc/ -- want at least %d; the AST walk is almost certainly missing a switch (moved/renamed file, changed tag name), not the source suddenly shrinking", len(dispatched), minDispatchedMethods)
	}

	classified := map[string]bool{}
	for m := range allowedMethods {
		classified[m] = true
	}
	for m := range allowedStreamMethods {
		classified[m] = true
	}
	for _, m := range writeMethods {
		classified[m] = true
	}
	for _, m := range hostAnsweredMethods {
		classified[m] = true
	}

	for _, method := range dispatched {
		if !classified[method] {
			t.Errorf(
				"gitrpc method %q is dispatched by Router.ForConn but classified in none of allowedMethods, allowedStreamMethods, writeMethods or hostAnsweredMethods (gitstream.go/gitstream_test.go) -- a new method needs an explicit decision, not silent default-refuse",
				method,
			)
		}
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
	// script/base path later executed verbatim by worktree.prepare) with no separate human-approval
	// gate. PullStrategy/CheckoutAutoStash flipped to `false` in P67e (docs/v1.6/plans/
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
		"LogLevel":              false,
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

// dispatchedGitrpcMethods parses every non-test .go file directly under internal/gitrpc/ (a sibling
// package under the same module, read as source text rather than imported — nothing here depends on
// gitrpc's own build) and returns every string literal case label from every `switch method { ... }`
// statement found in any of them — not just handlers.go, so a dispatch switch that moves to, or is
// added in, a different file in that package is still found (Group 4, P68 review: the original
// single-file walk silently found fewer methods on such a move, with the guard below (len == 0)
// never catching it since the file it *did* still hold onto still had at least one switch).
func dispatchedGitrpcMethods(t *testing.T) []string {
	t.Helper()
	const dir = "../gitrpc"

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir %s: %v", dir, err)
	}

	fset := token.NewFileSet()
	var methods []string
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		path := filepath.Join(dir, name)
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			sw, ok := n.(*ast.SwitchStmt)
			if !ok {
				return true
			}
			tag, ok := sw.Tag.(*ast.Ident)
			if !ok || tag.Name != "method" {
				return true
			}
			for _, stmt := range sw.Body.List {
				clause, ok := stmt.(*ast.CaseClause)
				if !ok {
					continue
				}
				for _, expr := range clause.List { // nil (skipped entirely) for `default:`
					lit, ok := expr.(*ast.BasicLit)
					if !ok || lit.Kind != token.STRING {
						continue
					}
					value, err := strconv.Unquote(lit.Value)
					if err != nil {
						t.Fatalf("unquote case label %s in %s: %v", lit.Value, path, err)
					}
					methods = append(methods, value)
				}
			}
			return true
		})
	}
	return methods
}
