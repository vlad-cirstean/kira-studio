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
