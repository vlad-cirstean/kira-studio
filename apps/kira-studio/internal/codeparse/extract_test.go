package codeparse

import (
	"os"
	"testing"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

// symRow/refRow flatten Symbol/Reference to the fields worth asserting in a golden table — name,
// kind, and (for symbols) which other row in the same table is its containment parent, expressed
// by index rather than by any Symbol field name so the table reads as a plain fixture.
type symRow struct {
	kind, name string
	parent     int
}
type refRow struct{ kind, name string }

// TestExtractGoldenFixtures is §11 point 3's anti-drift guard: one small committed fixture per
// symbol-bearing language, with the exact extracted symbol/reference set asserted as a table. A
// grammar or vendored-query upgrade that silently renames a node and stops matching shows up here
// as a table diff, not as a quietly empty index.
func TestExtractGoldenFixtures(t *testing.T) {
	cases := []struct {
		id   ID
		file string
		syms []symRow
		refs []refRow
	}{
		{
			id: Java, file: "testdata/extract/sample.java",
			syms: []symRow{
				{"interface", "Greeter", -1},
				{"method", "greet", 0},
				{"class", "Person", -1},
				{"method", "greet", 2},
				{"method", "helper", 2},
			},
			refs: []refRow{
				{"implementation", "Greeter"},
				{"call", "helper"},
			},
		},
		{
			id: Python, file: "testdata/extract/sample.py",
			syms: []symRow{
				{"class", "Greeter", -1},
				{"function", "greet", 0},
				{"function", "helper", -1},
			},
			refs: []refRow{{"call", "helper"}},
		},
		{
			id: JavaScript, file: "testdata/extract/sample.js",
			syms: []symRow{
				{"class", "Greeter", -1},
				{"method", "greet", 0},
				{"function", "helper", -1},
			},
			refs: []refRow{{"call", "helper"}},
		},
		{
			// TypeScript's own vendored tags.scm is deliberately thin (§4.1/§9: only what
			// upstream ships, nothing hand-written) — it has no pattern for a plain
			// class_declaration/function_declaration/method_definition or a predefined-type
			// annotation, only their abstract/signature-only/interface counterparts. The
			// fixture is written to exercise exactly what it does capture, honestly.
			id: TypeScript, file: "testdata/extract/sample.ts",
			syms: []symRow{
				{"interface", "Greeter", -1},
				{"method", "greet", 0},
				{"class", "Person", -1},
				{"method", "greet", 2},
				{"function", "helper", -1},
			},
			refs: []refRow{{"type", "Greeter"}, {"type", "Greeter"}},
		},
		{
			id: Go, file: "testdata/extract/sample.go",
			syms: []symRow{
				{"type", "Greeter", -1},
				{"type", "Person", -1},
				{"method", "Greet", -1},
				{"function", "helper", -1},
			},
			refs: []refRow{
				{"type", "Greeter"},
				{"type", "string"},
				{"type", "Person"},
				{"type", "Person"},
				{"type", "string"},
				{"call", "helper"},
				{"type", "string"},
			},
		},
		{
			// Rust's own function_item pattern matches both standalone (@definition.function)
			// and nested-in-a-declaration_list (@definition.method): the impl's real `fn
			// greet` is captured once under each kind at the same byte range, a real
			// upstream duplicate-by-kind rather than a defect (§4.2's own "duplicates are
			// real" note, extended here past its one stated example).
			id: Rust, file: "testdata/extract/sample.rs",
			syms: []symRow{
				{"interface", "Greeter", -1},
				{"class", "Person", -1},
				{"method", "greet", -1},
				{"function", "greet", 2},
				{"function", "helper", -1},
			},
			refs: []refRow{
				{"implementation", "Greeter"},
				{"call", "helper"},
				{"call", "format"},
			},
		},
	}

	for _, c := range cases {
		t.Run(string(c.id), func(t *testing.T) {
			src, err := os.ReadFile(c.file)
			if err != nil {
				t.Fatalf("read fixture: %v", err)
			}
			lang, err := languageFor(c.id)
			if err != nil {
				t.Fatalf("languageFor: %v", err)
			}
			parser := sitter.NewParser()
			defer parser.Close()
			if err := parser.SetLanguage(lang); err != nil {
				t.Fatalf("SetLanguage: %v", err)
			}
			tree := parser.Parse(src, nil)
			defer tree.Close()

			syms, refs, err := Extract(tree.RootNode(), src, c.id)
			if err != nil {
				t.Fatalf("Extract: %v", err)
			}

			gotSyms := make([]symRow, len(syms))
			for i, s := range syms {
				gotSyms[i] = symRow{s.Kind, s.Name, s.ParentIndex}
			}
			if !equalSymRows(gotSyms, c.syms) {
				t.Fatalf("symbols mismatch:\n got:  %+v\n want: %+v", gotSyms, c.syms)
			}

			gotRefs := make([]refRow, len(refs))
			for i, r := range refs {
				gotRefs[i] = refRow{r.Kind, r.Name}
			}
			if !equalRefRows(gotRefs, c.refs) {
				t.Fatalf("references mismatch:\n got:  %+v\n want: %+v", gotRefs, c.refs)
			}
		})
	}
}

func equalSymRows(a, b []symRow) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func equalRefRows(a, b []refRow) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
