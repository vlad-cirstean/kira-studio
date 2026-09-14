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
