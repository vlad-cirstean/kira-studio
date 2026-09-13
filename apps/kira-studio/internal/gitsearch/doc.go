// Package gitsearch is G23's port of upstream's server-side half of §7.8 search
// (docs/v1.3/plans/G23-search.md): compiling a wire SearchQueryParams into a matcher and running
// it over a streaming, cancellable, time-boxed `git log` tail scan.
//
// # What runs here vs. packages/git-core/src/search/
//
// The two packages are twins, not duplicates: packages/git-core/src/search/query.ts +
// matcher.ts stay the client's own compiler and matcher (SPEC §5 keeps them explicitly — the
// loaded-row scan and the ref scope are TypeScript for the whole life of this feature) and are
// this package's own conformance ORACLE (D9) — packages/git-core/testdata/searchConformance.json
// is read by both languages' test suites, and a change to either matcher's semantics adds rows
// there first, never edits one side alone.
//
// # The three-tier dialect posture (D3-D6)
//
// Go's regexp is RE2: no lookaround, no lookbehind, no backreferences, and a different meaning
// for `.`, `\s` and `\p` even where the syntax is accepted by both engines. This package never
// runs a second, silently-different engine against the same query text:
//
//  1. Literal mode (literal.go) runs NO regex engine at all — compileQuery's own literal pattern
//     is always a fixed, escaped needle, so "the wrapped JS pattern matches" reduces to
//     "some occurrence of needle has an acceptable word boundary on each side", computed directly
//     by occurrence enumeration plus a byte-level boundary post-check. This is byte-exact to JS by
//     construction, not by coincidence.
//  2. Regex mode (dialect.go) translates the seven rewritable constructs F15 names (`.`, `\s`/
//     `\S`, `\p`/`\P`, `\uXXXX`/`\u{...}`, `\cA`-`\cZ`, a bare `\0`, an unknown identity escape)
//     into their RE2 equivalents, then wraps whole-word as a CONSUMING rewrite (D5) rather than a
//     naive post-check — a post-check disagrees with JS's own backtracking-into-a-different-
//     alternative behaviour on a pattern like `foo|foobar`.
//  3. What RE2 genuinely cannot express — lookahead, lookbehind, a numbered or named
//     backreference — is REJECTED with ErrUnsupportedPattern, never silently dropped: the server
//     answers `{kind: "unsupportedPattern"}` as data (D6), so a hit's presence never depends on
//     which page happened to be loaded (docs/v1.3/SPEC.md:446-450).
//
// One knowingly-accepted divergence survives in regex mode: case folding is RE2's own `(?i)`, not
// literal.go's ECMA-262 Canonicalize (foldRune) — so the Kelvin-sign class of difference (`/k/i`
// not matching U+212A in JS) can, in principle, disagree in *regex* mode only. Literal mode stays
// exact regardless of case sensitivity (§10.3).
//
// # The named twin
//
// A change to matchCommitFields' semantics, to compileQuery's dialect surface, or to whole-word's
// definition lands in THREE places together: this package, packages/git-core/src/search/
// {query,matcher}.ts, and packages/git-core/testdata/searchConformance.json (both suites read the
// same corpus — conformance_test.go here, conformance.test.ts there).
package gitsearch
