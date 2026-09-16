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
			// Robot extends Person, and Robot.build() constructs one (§2.2/§2.4): exercises
			// referenceKinds' new "class" entry (both the superclass and the `new` site) on top of
			// the pre-existing interface/implements/call coverage.
			id: Java, file: "testdata/extract/sample.java",
			syms: []symRow{
				{"interface", "Greeter", -1},
				{"method", "greet", 0},
				{"class", "Person", -1},
				{"method", "greet", 2},
				{"method", "helper", 2},
				{"class", "Robot", -1},
				{"method", "build", 5},
			},
			refs: []refRow{
				{"implementation", "Greeter"},
				{"call", "helper"},
				{"class", "Person"},
				{"class", "Person"},
			},
		},
		{
			// Robot(Greeter) exercises §2.3's C2-authored c2_implements.scm — Python's own tags.scm
			// has no base-class pattern at all.
			id: Python, file: "testdata/extract/sample.py",
			syms: []symRow{
				{"class", "Greeter", -1},
				{"function", "greet", 0},
				{"function", "helper", -1},
				{"class", "Robot", -1},
				{"function", "greet", 3},
			},
			refs: []refRow{
				{"call", "helper"},
				{"implementation", "Greeter"},
				{"call", "helper"},
			},
		},
		{
			// Robot extends Greeter (§2.3's c2_implements.scm) and constructs one (§2.2's "class"
			// referenceKinds entry, already vendored in javascript's own tags.scm but dropped
			// before this phase).
			// P64b adds module-level constant coverage (docs/v1.6/plans/
			// P64b-repo-map-go-and-javascript-constants.md §2.5/§4.2): an export const bound to an
			// object and a bare const bound to a call expression (both new patterns), an
			// arrow-valued export const asserting a single "function" row and no duplicate
			// "constant" row, a const inside a function body asserting no row (the `program`
			// anchor), and a module-level `let` asserting no row (deliberately excluded, matching
			// P64 §2.2's own decision for TypeScript).
			id: JavaScript, file: "testdata/extract/sample.js",
			syms: []symRow{
				{"class", "Greeter", -1},
				{"method", "greet", 0},
				{"function", "helper", -1},
				{"class", "Robot", -1},
				{"method", "build", 3},
				{"constant", "robotDefaults", -1},
				{"constant", "robotFactory", -1},
				{"function", "buildRobot", -1},
				{"function", "helper2", -1},
				// P67f adds the new "read" reference kind (docs/v1.6/plans/
				// P67f-repo-map-sync-and-references.md §3.3/§5.3): a for...of over
				// p67fSampleItems and an index read of it (two "read" rows), and a for...of over
				// p67fMakeItems() — a call expression, not a bare identifier — produces no "read"
				// row (only the pre-existing "call" reference the call itself already earns).
				{"constant", "p67fSampleItems", -1},
				{"function", "p67fMakeItems", -1},
				{"function", "p67fHelperReads", -1},
				{"constant", "p69bArg", -1},
				{"constant", "p69bLeft", -1},
				{"constant", "p69bRight", -1},
				{"constant", "p69bObj", -1},
				{"function", "p69bConsume", -1},
				{"function", "p69bHelperReads", -1},
				// M1c (docs/v1.7/plans/M1c-repomap-struct-field-fix.md §2.3/§2.4/§4.3): a class
				// field declaration, a read of it, and a called selector (one "call" row, no
				// duplicate "field" row, §2.6) plus a method value (one "field" row).
				{"class", "M1cClass", -1},
				{"field", "m1cField", 18},
				{"method", "m1cMethod", 18},
				{"constant", "m1cInstance", -1},
				{"function", "m1cHelperReads", -1},
			},
			// P69b adds the new "arguments"/"binary_expression" read patterns (docs/v1.6/plans/
			// P69b-repo-map-bare-identifier-reads.md §4.1/§6.2): the two pre-existing fixture
			// sites above now each earn an extra "read" row — "name" from `helper(name)`'s own
			// call argument and from `"hi " + name`'s own binary operand, "v" from each
			// `console.log(v)` call (twice) — plus a dedicated p69b block covering an identifier
			// call argument (p69bArg, one row), both comparison operands (p69bLeft/p69bRight, two
			// rows), and a non-identifier (selector) call argument producing no row.
			refs: []refRow{
				{"call", "helper"},
				{"read", "name"},
				{"read", "name"},
				{"implementation", "Greeter"},
				{"class", "Greeter"},
				{"call", "makeRobot"},
				{"class", "Robot"},
				{"read", "p67fSampleItems"},
				{"call", "log"},
				{"read", "v"},
				{"read", "p67fSampleItems"},
				{"call", "p67fMakeItems"},
				{"call", "log"},
				{"read", "v"},
				{"call", "p69bConsume"},
				{"read", "p69bArg"},
				{"read", "p69bLeft"},
				{"read", "p69bRight"},
				{"call", "p69bConsume"},
				// M1c: p69bObj.val (the existing "non-identifier call argument" line above) now also
				// earns a "field" reference — a member_expression call argument matches
				// m1c_member_reads.scm same as any other. Then the dedicated M1c block: the class
				// body's own selector read (this.m1cField), the `new M1cClass()` "class" reference,
				// the instance read, the called selector's single "call" row, and the method value's
				// own "field" row.
				{"field", "val"},
				{"field", "m1cField"},
				{"class", "M1cClass"},
				{"field", "m1cField"},
				{"call", "m1cMethod"},
				{"field", "m1cMethod"},
			},
		},
		{
			// TypeScript's own vendored tags.scm is deliberately thin (§4.1/§9: only what
			// upstream ships, nothing hand-written) — it has no pattern for a plain
			// class_declaration/function_declaration/method_definition or a predefined-type
			// annotation, only their abstract/signature-only/interface counterparts. §2.1 composes
			// javascript's own tags.scm ahead of it, which is what makes Robot's plain
			// class/method/call and helper2's plain function show up at all; §2.3's
			// c2_implements.scm adds the second "implementation" reference, for Robot's own
			// `implements Greeter`.
			id: TypeScript, file: "testdata/extract/sample.ts",
			// P64 adds a type alias, an enum, a call-expression-valued module const, an
			// arrow-valued module const and a function-body const (docs/v1.6/plans/
			// P64-repo-map-type-aliases-and-read-symbol.md §2.2/§8): the anti-drift guard this
			// test exists for now also covers the p64_declarations.scm patterns, not only the
			// vendored ones. buildRobot is a "function" row (javascript's own unanchored
			// arrow-const pattern), never a "constant" row — proving p64's own const pattern
			// correctly excludes an arrow-valued value. helper3's own function-body const
			// produces no row at all, proving the `program` anchor holds.
			syms: []symRow{
				{"interface", "Greeter", -1},
				{"method", "greet", 0},
				{"class", "Person", -1},
				{"method", "greet", 2},
				{"function", "helper", -1},
				{"class", "Robot", -1},
				{"method", "greet", 5},
				{"function", "helper2", -1},
				{"type", "RobotKind", -1},
				{"enum", "RobotState", -1},
				{"constant", "robotConfig", -1},
				{"function", "buildRobot", -1},
				{"function", "helper3", -1},
				// P64b (§2.7/§4.3): a regex-valued module const, invisible before the value list
				// widened to include (regex) (ternary_expression) (await_expression)
				// (subscript_expression).
				{"constant", "OPERATOR_RE", -1},
				// P67f adds the new "read" reference kind (docs/v1.6/plans/
				// P67f-repo-map-sync-and-references.md §3.3/§5.3), same shape as JavaScript's own
				// case above: a for...of over p67fSampleItems and an index read of it (two "read"
				// rows), and a for...of over p67fMakeItems() (a call expression) produces no
				// "read" row.
				{"constant", "p67fSampleItems", -1},
				{"function", "p67fMakeItems", -1},
				{"function", "p67fHelperReads", -1},
				// P69b: same dedicated block as sample.js above (docs/v1.6/plans/
				// P69b-repo-map-bare-identifier-reads.md §6.2).
				{"constant", "p69bArg", -1},
				{"constant", "p69bLeft", -1},
				{"constant", "p69bRight", -1},
				{"constant", "p69bObj", -1},
				{"function", "p69bConsume", -1},
				{"function", "p69bHelperReads", -1},
				// M1c (docs/v1.7/plans/M1c-repomap-struct-field-fix.md §2.2/§2.4/§4.3): an interface
				// with two properties, a type-literal with one, and a class with a public field and a
				// `#private` one (the private field earns neither a symbol nor a reference row —
				// it's a private_property_identifier, a different node kind m1c_members.scm does not
				// match, and so is every read of it).
				{"interface", "M1cInterface", -1},
				{"field", "m1cPropA", 23},
				{"field", "m1cPropB", 23},
				{"type", "M1cTypeLiteral", -1},
				{"field", "m1cLiteralProp", 26},
				{"class", "M1cClass", -1},
				{"field", "m1cField", 28},
				{"method", "m1cMethod", 28},
				{"method", "m1cReadPrivate", 28},
				{"constant", "m1cInstance", -1},
				{"function", "m1cHelperReads", -1},
			},
			// P69b: same incidental-row growth as sample.js above ("name" from helper2(name)'s
			// call argument and from "hi " + name's binary operand), plus the same dedicated
			// p69b block appended at the end (docs/v1.6/plans/
			// P69b-repo-map-bare-identifier-reads.md §4.1/§6.2).
			refs: []refRow{
				{"implementation", "Greeter"},
				{"type", "Greeter"},
				{"type", "Greeter"},
				{"implementation", "Greeter"},
				{"call", "helper2"},
				{"read", "name"},
				{"read", "name"},
				{"call", "makeConfig"},
				{"class", "Robot"},
				{"read", "p67fSampleItems"},
				{"call", "log"},
				{"read", "v"},
				{"read", "p67fSampleItems"},
				{"call", "p67fMakeItems"},
				{"call", "log"},
				{"read", "v"},
				{"call", "p69bConsume"},
				{"read", "p69bArg"},
				{"read", "p69bLeft"},
				{"read", "p69bRight"},
				{"call", "p69bConsume"},
				// M1c: p69bObj.val (the existing "non-identifier call argument" line above) now also
				// earns a "field" reference, same as sample.js. Then the dedicated M1c block: the two
				// `declare const` type annotations, the class body's own selector read
				// (this.m1cField), the `new M1cClass()` "class" reference, the interface/type-literal
				// property reads, the instance field read, the called selector's single "call" row
				// (no duplicate "field" row, §2.6), the method value's own "field" row, and the
				// `#private` read's plain "call" row with no "field" row at either end.
				{"field", "val"},
				{"type", "M1cInterface"},
				{"type", "M1cTypeLiteral"},
				{"field", "m1cField"},
				{"class", "M1cClass"},
				{"field", "m1cPropA"},
				{"field", "m1cPropB"},
				{"field", "m1cLiteralProp"},
				{"field", "m1cField"},
				{"call", "m1cMethod"},
				{"field", "m1cMethod"},
				{"call", "m1cReadPrivate"},
			},
		},
		{
			// P64b adds package-level const/var coverage (docs/v1.6/plans/
			// P64b-repo-map-go-and-javascript-constants.md §2.2/§4.1): an iota block (KindA/B/C,
			// the 2nd/3rd names valueless), a grouped string-const block, a grouped `var ( … )`
			// block (exercises var_spec_list, §1.3), a single var and a single const, and one
			// const plus one var inside helper2's own body — the latter two produce no rows at
			// all, proving the source_file anchor (§2.3) excludes function-local declarations.
			// P67f adds the new "read" reference kind (docs/v1.6/plans/
			// P67f-repo-map-sync-and-references.md §3.2/§5.3): p67fSampleReadMap is read once via
			// `range` and once via an index expression (two "read" rows),
			// p67fSampleNestedMap["a"]["b"] is a nested subscript resolving once to
			// p67fSampleNestedMap (not "a" or "b"), and p67fSampleContainerVal.items/
			// p67fSampleContainerVal.m["x"] (a range and an index whose operand is a selector, not
			// a bare identifier) produce no "read" row at all — the p67fSampleContainer/
			// p67fSampleReadMap/p67fSampleNestedMap/p67fSampleContainerVal declarations themselves
			// also add ordinary "type"/"variable" symbol and reference rows exactly like the
			// pre-existing declarations above them. Fixture names are prefixed p67f rather than
			// reused from the real allowedMethods-shaped production code this phase fixes — this
			// fixture is indexed alongside the rest of the repository by the live MCP server, and
			// a colliding name would make find_references ambiguous against it.
			id: Go, file: "testdata/extract/sample.go",
			syms: []symRow{
				{"type", "Greeter", -1},
				// P78 (docs/v1.8/plans/P78-code-navigation.md §3.1/§4.1): Greeter's own method_elem,
				// previously invisible — parented to Greeter (index 0) the same way Java's vendored
				// query already parents an interface method. Not a p78-prefixed fixture addition:
				// this is the pre-existing Greeter interface gaining a row it never had, the same
				// general capture p78Reader/p78ReadCloser below also exercise.
				{"method", "Greet", 0},
				{"type", "Person", -1},
				{"method", "Greet", -1},
				{"function", "helper", -1},
				{"constant", "KindA", -1},
				{"constant", "KindB", -1},
				{"constant", "KindC", -1},
				{"constant", "StateIdle", -1},
				{"constant", "StateRunning", -1},
				{"variable", "ErrNotFound", -1},
				{"variable", "maxRetries", -1},
				{"variable", "DefaultName", -1},
				{"constant", "Version", -1},
				{"function", "helper2", -1},
				{"variable", "p67fSampleReadMap", -1},
				{"variable", "p67fSampleNestedMap", -1},
				{"type", "p67fSampleContainer", -1},
				// M1c (docs/v1.7/plans/M1c-repomap-struct-field-fix.md §4.2): the struct's own two
				// fields, invisible before m1c_fields.scm — parented to p67fSampleContainer (index
				// 17, shifted by one from M1c's own comment since P78's new Greeter.Greet row above
				// inserted ahead of it) via ordinary range containment, same as any other nested
				// symbol.
				{"field", "m", 17},
				{"field", "items", 17},
				{"variable", "p67fSampleContainerVal", -1},
				{"function", "p67fHelperReads", -1},
				{"variable", "p69bArg", -1},
				{"variable", "p69bLeft", -1},
				{"variable", "p69bRight", -1},
				{"function", "p69bConsume", -1},
				{"function", "p69bHelperReads", -1},
				// M1c: a named struct with an exported and an unexported field, a method, a selector
				// read of each field, a called selector (one "call" row, no duplicate "field" row,
				// §2.6), a method value (no call: one "field" row), a keyed composite literal (no
				// "field" reference row, §8.1's declined scope), and an anonymous function-local
				// struct (no "field" symbol row: the source_file anchor, §2.1, excludes it —
				// m1cLocalStruct itself still earns the pre-existing, unrelated "type" row every
				// type_spec earns regardless of nesting).
				{"type", "m1cStruct", -1},
				{"field", "M1cExported", 27},
				{"field", "m1cUnexported", 27},
				{"method", "M1cMethod", -1},
				{"variable", "m1cStructVal", -1},
				{"function", "m1cHelperReads", -1},
				{"function", "m1cAnonStruct", -1},
				{"type", "m1cLocalStruct", 33},
				// P78 §11.1: a pointer, a value and a generic receiver (methodsets.go's own
				// receiverTypeOf reads exactly this shape); a two-method interface and one embedding
				// it (interface_type's own method_elem/type_elem, §2.2/§3.1); a struct embedding both
				// a plain and a pointer type (§2.3) — each embedded type earns its own "field" symbol
				// row (M1c's documented gap, closed by p78_method_sets.scm's second pattern) parented
				// to p78Dog (index 49) exactly like any other field.
				{"type", "p78Value", -1},
				{"method", "ValueMethod", -1},
				{"type", "p78Ptr", -1},
				{"method", "PtrMethod", -1},
				{"type", "p78Box", -1},
				{"field", "v", 39},
				{"method", "GenericMethod", -1},
				{"type", "p78Reader", -1},
				{"method", "Read", 42},
				{"method", "Close", 42},
				{"type", "p78ReadCloser", -1},
				{"method", "Extra", 45},
				{"type", "p78Animal", -1},
				{"method", "Speak", -1},
				{"type", "p78Dog", -1},
				{"field", "p78Animal", 49},
				{"field", "p78Ptr", 49},
			},
			refs: []refRow{
				{"type", "Greeter"},
				{"type", "string"},
				{"type", "Person"},
				// P78 §3.2: previously a second, duplicate {"type","Person"} at this identical name
				// range — the receiver's own type identifier, now labelled "receiver" instead
				// (dropDuplicateNameRangeRefs' own generalization of M1c's call-vs-field dedupe).
				{"receiver", "Person"},
				{"type", "string"},
				{"call", "helper"},
				{"type", "string"},
				{"type", "string"},
				{"type", "string"},
				{"type", "string"},
				{"type", "int"},
				{"type", "p67fSampleContainer"},
				{"type", "string"},
				{"type", "int"},
				{"type", "int"},
				{"type", "p67fSampleContainer"},
				{"read", "p67fSampleReadMap"},
				{"read", "p67fSampleReadMap"},
				// M1c: p67fSampleContainerVal.items (range operand, sample.go:72) and .m (index
				// operand, sample.go:74) each now also earn a "field" reference — the existing
				// comment's claim that they "produce no read row at all" stays true and stays put
				// (they still don't; "field" is a different, additional kind).
				{"field", "items"},
				{"field", "m"},
				{"read", "p67fSampleNestedMap"},
				// P69b: p69bConsume's own parameter types ("int", "byte" for buf []byte) are
				// ordinary pre-existing "type" reference captures, incidental to adding parameters
				// at all — not new in this phase. p69bConsume(p69bArg) earns "call"+"read"; the
				// comparison earns both operands; p69bConsume(p67fSampleContainerVal.items) earns
				// "call" plus M1c's own new "field" row for that same selector argument; buf[:p69bArg]
				// earns two rows — "buf" (the slice's own operand field, also newly captured for the
				// slice form) and "p69bArg" (the slice's end bound, the case this phase's repro
				// finding names explicitly).
				{"type", "int"},
				{"type", "byte"},
				{"call", "p69bConsume"},
				{"read", "p69bArg"},
				{"read", "p69bLeft"},
				{"read", "p69bRight"},
				{"call", "p69bConsume"},
				{"field", "items"},
				{"read", "buf"},
				{"read", "p69bArg"},
				// M1c: the dedicated block above — receiver/field/return types (ordinary "type"
				// rows), the two field reads, the called selector's single "call" row with no
				// duplicate "field" row (§2.6), the method value's own "field" row, the keyed
				// composite literal's "type" row with no "field" row for its key (§8.1), and the
				// anonymous struct's own "type" rows (both the declaration's self-reference and its
				// own composite literal), still with no "field" row for X.
				{"type", "m1cStruct"},
				{"type", "int"},
				{"type", "int"},
				// P78 §3.2: M1cMethod's own receiver, the same duplicate-row fix as Person's above.
				{"receiver", "m1cStruct"},
				{"type", "int"},
				{"field", "M1cExported"},
				{"type", "m1cStruct"},
				{"field", "M1cExported"},
				{"field", "m1cUnexported"},
				{"call", "M1cMethod"},
				{"field", "M1cMethod"},
				{"type", "m1cStruct"},
				{"type", "m1cLocalStruct"},
				{"type", "int"},
				{"type", "m1cLocalStruct"},
				// P78 §11.1: p78Value/p78Ptr/p78Box's own declaration-self "type" row plus their
				// receiver's "receiver" row (§3.2's dedupe, same as Person/m1cStruct above); p78Box's
				// own type parameter ("any", "T" — ordinary pre-existing "type" captures, incidental
				// to a generic declaration); p78Reader's two method return types; p78ReadCloser's own
				// "embed" row for embedding p78Reader (§3.1's interface type_elem pattern); p78Animal's
				// blank-name receiver (still captured — a receiver reference needs no receiver
				// variable name, only the type); p78Dog's own two "embed" rows for its plain and
				// pointer embedded types (§2.3, §3.1's struct field_declaration pattern).
				{"type", "p78Value"},
				{"receiver", "p78Value"},
				{"type", "p78Ptr"},
				{"receiver", "p78Ptr"},
				{"type", "p78Box"},
				{"type", "any"},
				{"type", "T"},
				{"receiver", "p78Box"},
				{"type", "T"},
				{"type", "p78Reader"},
				{"type", "string"},
				{"type", "error"},
				{"type", "p78ReadCloser"},
				{"embed", "p78Reader"},
				{"type", "int"},
				{"type", "p78Animal"},
				{"receiver", "p78Animal"},
				{"type", "string"},
				{"type", "p78Dog"},
				{"embed", "p78Animal"},
				{"embed", "p78Ptr"},
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

			syms, refs, err := extractSymbols(tree.RootNode(), src, c.id)
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
