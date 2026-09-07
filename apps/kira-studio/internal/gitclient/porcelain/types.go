// Package porcelain is the log walk's own porcelain layer (docs/v1.3/plans/G3-history-pipeline-
// and-wire-format.md, D8): the -z/%x1f record splitter, the log record format and its argv
// builders, decoration classification, and the ref snapshot the paged walk's --skip resume guards
// itself with. Nothing else — status/diff/stash/refs.list's own parser each land with the RPC
// that reads them (G4/G5/G8).
package porcelain

// CommitIdentity is a commit's author or committer identity — structurally matching
// @kira/git-ipc's own CommitIdentity (contract.ts).
type CommitIdentity struct {
	Name      string
	Email     string
	Timestamp int64 // unix seconds
}

// DecorationRefKind is DecorationRef's own discriminant, mirroring @kira/git-ipc's union verbatim.
type DecorationRefKind string

const (
	DecorationBranch       DecorationRefKind = "branch"
	DecorationRemoteBranch DecorationRefKind = "remoteBranch"
	DecorationTag          DecorationRefKind = "tag"
	DecorationHead         DecorationRefKind = "head"
	DecorationStash        DecorationRefKind = "stash"
)

// DecorationRef is one ref pointing at a commit, classified from `%D`'s output — structurally
// matching @kira/git-ipc's own DecorationRef union: Name is meaningless for "head", IsHead is
// meaningful only for "branch", Index only for "stash".
type DecorationRef struct {
	Kind   DecorationRefKind
	Name   string
	IsHead bool
	Index  int
}

// CommitRecord is one parsed `git log` record — the Go shape the paged walk, the store and the
// packer all consume.
type CommitRecord struct {
	SHA        string
	Parents    []string // shas, in %P's own order
	Author     CommitIdentity
	Committer  CommitIdentity
	Decoration []DecorationRef
	Subject    string
}

// RangeSpec is a two-dot `<base>..<branch>` review range (SPEC §6.8) — declared here so WalkSpec
// can carry it, but G3 never sets it: the ranged walk is G6's (D14 refuses `range` on every
// method that accepts one).
type RangeSpec struct {
	Base   string
	Branch string
}

// WalkSpec selects one walk's rev set — the single builder RevSetArgs/WalkArgs share across the
// paged walk, the remaining-count query and (G10) the tail scan, so all three agree on exactly
// the same commits in exactly the same order (D21).
type WalkSpec struct {
	// Scope is "all" or "head" (the contract's own graph.scope values); "all" is the default when
	// empty, matching D14's server-side default.
	Scope string
	// Range, when non-nil, walks Base..Branch instead of Scope's rev set (G6). G3 never sets it.
	Range *RangeSpec
	// StashShas/IncludeStash: revSetArgs keeps upstream's stash parameters because WalkArgs is one
	// builder shared by the walk, the count and the scan (D8) — G3 always passes
	// IncludeStash=false, which is the "no stash rows" rev set (`--all`, no extra shas); G8
	// supplies real values.
	StashShas    []string
	IncludeStash bool
}
