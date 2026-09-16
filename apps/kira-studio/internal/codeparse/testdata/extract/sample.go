package sample

type Greeter interface {
	Greet() string
}

type Person struct{}

func (p Person) Greet() string {
	return helper()
}

func helper() string {
	return "hi"
}

// P64b: iota const block — a valueless 2nd/3rd name still has a `name` field (§2.2/§8.1).
const (
	KindA = iota
	KindB
	KindC
)

// P64b: grouped string-const block — the typed-string enum idiom this repo actually uses (§8.1).
const (
	StateIdle    = "idle"
	StateRunning = "running"
)

// P64b: grouped var ( … ) block — exercises var_spec_list traversal, not var_spec (§1.3).
var (
	ErrNotFound = "not found"
	maxRetries  = 3
)

// P64b: single var and single const, the non-list form.
var DefaultName = "kira"

const Version = "1.0"

// P64b: a const and a var inside a function body — the source_file anchor excludes both (§2.3).
func helper2() {
	const localConst = "not indexed"
	var localVar = 0
	_ = localConst
	_ = localVar
}

// P67f: a package-level map, read via range and index (§3.2's new "read" reference kind). Named
// distinctly from any real production identifier — this fixture is indexed alongside the rest of
// the repository, and a colliding name would make find_references ambiguous against it.
var p67fSampleReadMap = map[string]struct{}{"GET": {}}

// P67f: a nested map, proving a nested subscript resolves to the outermost identifier only.
var p67fSampleNestedMap = map[string]map[string]int{}

type p67fSampleContainer struct {
	m     map[string]int
	items []int
}

var p67fSampleContainerVal p67fSampleContainer

// P67f: exercises range_clause/index_expression reads plus the two "no row" cases (§5.3): a
// range over a selector (p67fSampleContainerVal.items) and an index whose operand is a selector
// (p67fSampleContainerVal.m[...]).
func p67fHelperReads() {
	for k := range p67fSampleReadMap {
		_ = k
	}
	_ = p67fSampleReadMap["GET"]
	for range p67fSampleContainerVal.items {
	}
	_ = p67fSampleContainerVal.m["x"]
	_ = p67fSampleNestedMap["a"]["b"]
}

// P69b: a bare-identifier read as a call argument and as both operands of a comparison, a
// non-identifier call argument (no row), and a slice bound — the commonest read shapes P67f's
// range/index patterns above didn't reach (docs/v1.6/plans/
// P69b-repo-map-bare-identifier-reads.md §6.2).
var p69bArg = 1
var p69bLeft = 2
var p69bRight = 3

func p69bConsume(n int) {}

func p69bHelperReads(buf []byte) {
	p69bConsume(p69bArg)
	_ = p69bLeft < p69bRight
	p69bConsume(p67fSampleContainerVal.items)
	_ = buf[:p69bArg]
}

// M1c: struct field declarations and non-call selector reads (docs/v1.7/plans/
// M1c-repomap-struct-field-fix.md §2.1/§4.2). Fixture names prefixed m1c per the fixture's own rule
// above — this fixture is indexed alongside the rest of the repository by the live MCP server, and
// a colliding name would make find_references ambiguous.
type m1cStruct struct {
	M1cExported   int
	m1cUnexported int
}

func (s m1cStruct) M1cMethod() int { return s.M1cExported }

var m1cStructVal m1cStruct

// M1c: exercises the new "field" symbol/reference rows, §2.6's call-duplicate suppression (a called
// selector earns only "call", not "call" + "field"), and §8.1's declined composite-literal-key case
// (a keyed field in T{Field: value} is not a selector_expression, so it earns no "field" row).
func m1cHelperReads() {
	_ = m1cStructVal.M1cExported
	_ = m1cStructVal.m1cUnexported
	_ = m1cStructVal.M1cMethod() // called: one "call" row, no duplicate "field" row
	f := m1cStructVal.M1cMethod  // method value, not called: one "field" row
	_ = f
	_ = m1cStruct{M1cExported: 1} // keyed composite literal: no "field" reference row (§8.1)
}

// M1c: an anonymous, function-local struct — the source_file anchor (§2.1) must exclude its field
// from the symbol table.
func m1cAnonStruct() {
	type m1cLocalStruct struct {
		X int
	}
	_ = m1cLocalStruct{X: 1}
}

// P78: method-set captures (docs/v1.8/plans/P78-code-navigation.md §3.1/§11.1) — a pointer, a
// value and a generic receiver; a two-method interface; an interface embedding another; a struct
// embedding a plain and a pointer type. Prefixed p78 per the fixture's own naming rule (§11.1) —
// this fixture is indexed alongside the rest of the repository by the live MCP server, and a
// colliding name would poison find_references.
type p78Value struct{}

func (v p78Value) ValueMethod() {}

type p78Ptr struct{}

func (p *p78Ptr) PtrMethod() {}

type p78Box[T any] struct{ v T }

func (b *p78Box[T]) GenericMethod() {}

type p78Reader interface {
	Read() string
	Close() error
}

type p78ReadCloser interface {
	p78Reader
	Extra() int
}

type p78Animal struct{}

func (p78Animal) Speak() string { return "" }

type p78Dog struct {
	p78Animal
	*p78Ptr
}
