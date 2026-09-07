// Package gitreview holds branch review's base-resolution policy (docs/v1.3/plans/G6-branch-
// review-base-resolver-and-the-ranged-walk.md, D7a): a pure classifier over a for-each-ref
// snapshot, with no I/O — the caller (gitsession.RepoEntry.ResolveReviewBase) has already fetched
// the ref snapshot (cached) and the origin/HEAD answer (one spawn, only when needed) before
// calling ResolveBase. Imports gitclient/porcelain (for RefRow) and stdlib only, the same
// one-directional leaf dependency gitpreflight has.
package gitreview

import "github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"

// Reason mirrors @kira/git-ipc's own BaseResolutionReason.
type Reason string

const (
	// ReasonUpstream is §6.8 step 1: the branch's upstream, and it names a different branch.
	ReasonUpstream Reason = "upstream"
	// ReasonDefaultBranch is §6.8 step 2: origin/HEAD, or the first existing baseCandidates member.
	ReasonDefaultBranch Reason = "defaultBranch"
	// ReasonOverride: the user picked it from the header picker — never returned by ResolveBase
	// itself; gitsession's own orchestration substitutes it when an explicit base is supplied.
	ReasonOverride Reason = "override"
	// ReasonNone is §6.8 step 3: nothing detected. Base is nil and no walk is opened.
	ReasonNone Reason = "none"
)

// Candidate is one entry in the header picker's shortlist — @kira/git-ipc's own BaseCandidate.
// Reason is never ReasonOverride/ReasonNone: a candidate is a thing detected from the snapshot,
// never a thing the user chose.
type Candidate struct {
	Ref    string `json:"ref"`
	Kind   string `json:"kind"` // porcelain.RefRow.Kind: "branch" | "remoteBranch"
	Reason Reason `json:"reason"`
}

// RangeState is contract.ts's ReviewRangeState union. CommitCount is present only for "ready"
// (G4 D5's absent-vs-null rule) — exactly what omitempty on a *int reproduces.
type RangeState struct {
	Kind        string `json:"kind"` // "ready" | "empty" | "unrelated" | "ask"
	CommitCount *int   `json:"commitCount,omitempty"`
}

// BaseResolution is @kira/git-ipc's own BaseResolution, field for field.
type BaseResolution struct {
	Branch string `json:"branch"`
	// Base is present-and-null when Reason == ReasonNone — never omitted.
	Base       *string     `json:"base"`
	Reason     Reason      `json:"reason"`
	Range      RangeState  `json:"range"`
	Candidates []Candidate `json:"candidates"` // never nil — an empty list marshals as []
}

// Input is ResolveBase's own parameter object — upstream's ResolveBaseInput.
type Input struct {
	// Branch is the branch under review — its Upstream/ShortName/IsHead are what step 1 reads.
	Branch                   porcelain.RefRow
	Branches, RemoteBranches []porcelain.RefRow
	// OriginHead is `git symbolic-ref --short refs/remotes/origin/HEAD`'s answer, or "" when unset
	// (probe P1: an absent or dangling origin/HEAD is "not set", never an error).
	OriginHead string
	// Candidates is kiraVersion.review.baseCandidates, in configured order.
	Candidates []string
}

// Core is ResolveBase's own result — upstream's BaseResolutionCore, the part this pure function
// can answer (the range's walkability needs two more git spawns gitsession runs, D7c).
type Core struct {
	// Base is nil iff Reason == ReasonNone.
	Base       *string
	Reason     Reason
	Candidates []Candidate
}

// DefaultBaseCandidates mirrors SETTINGS' own kiraVersion.review.baseCandidates default — the
// server's own fallback for a raw socket client with no settings snapshot to inject from (D1).
var DefaultBaseCandidates = []string{"main", "master"}

// bareUpstreamName strips every namespace prefix AND the remote name: "refs/heads/main" ->
// "main"; "refs/remotes/origin/develop" -> "develop" — the COMPARISON name §6.8 step 1 checks
// against branch.ShortName ("feature-x" tracking "refs/remotes/origin/feature-x" compares
// feature-x == feature-x, not origin/feature-x == feature-x).
func bareUpstreamName(upstream string) string {
	const headsPrefix = "refs/heads/"
	if len(upstream) > len(headsPrefix) && upstream[:len(headsPrefix)] == headsPrefix {
		return upstream[len(headsPrefix):]
	}
	const remotesPrefix = "refs/remotes/"
	if len(upstream) > len(remotesPrefix) && upstream[:len(remotesPrefix)] == remotesPrefix {
		rest := upstream[len(remotesPrefix):]
		for i := 0; i < len(rest); i++ {
			if rest[i] == '/' {
				return rest[i+1:]
			}
		}
	}
	return upstream
}

// upstreamRefShortName strips only the namespace prefix, keeping the remote name: "refs/heads/
// main" -> "main"; "refs/remotes/origin/develop" -> "origin/develop" — exactly RefRow.ShortName's
// own convention, so the result can be looked up against branches/remoteBranches by ShortName and,
// once found, handed to merge-base/rev-list verbatim as base.
func upstreamRefShortName(upstream string) string {
	const headsPrefix = "refs/heads/"
	if len(upstream) > len(headsPrefix) && upstream[:len(headsPrefix)] == headsPrefix {
		return upstream[len(headsPrefix):]
	}
	const remotesPrefix = "refs/remotes/"
	if len(upstream) > len(remotesPrefix) && upstream[:len(remotesPrefix)] == remotesPrefix {
		return upstream[len(remotesPrefix):]
	}
	return upstream
}

func findRef(branches, remoteBranches []porcelain.RefRow, shortName string) (porcelain.RefRow, bool) {
	for _, r := range branches {
		if r.ShortName == shortName {
			return r, true
		}
	}
	for _, r := range remoteBranches {
		if r.ShortName == shortName {
			return r, true
		}
	}
	return porcelain.RefRow{}, false
}

// ResolveBase is §6.8's three-step order, ported rule for rule from upstream's core/src/model/
// review.ts:
//
//  1. The branch's upstream, when it names a genuinely different branch AND still resolves to a
//     real ref in this snapshot (a "gone" upstream whose remote-tracking ref has since been
//     pruned falls through, exactly as an absent upstream does).
//  2. OriginHead, if it resolves in this snapshot; else the first Candidates member that does.
//  3. Neither ⇒ Base: nil, Reason: ReasonNone.
//
// The candidate shortlist is built in the same pass, ordered upstream (when it exists at all,
// even when step 1 rejected it for being same-named — the user may deliberately want
// origin/feature-x as its own base) → OriginHead → each existing Candidates member in configured
// order → the current HEAD branch when it is none of the above, de-duplicated by ref name, first
// reason wins.
func ResolveBase(in Input) Core {
	var upstreamShort, upstreamBareName string
	var hasUpstream bool
	if in.Branch.Upstream != nil {
		hasUpstream = true
		upstreamShort = upstreamRefShortName(*in.Branch.Upstream)
		upstreamBareName = bareUpstreamName(*in.Branch.Upstream)
	}
	upstreamRef, upstreamFound := porcelain.RefRow{}, false
	if hasUpstream {
		upstreamRef, upstreamFound = findRef(in.Branches, in.RemoteBranches, upstreamShort)
	}

	var base *string
	reason := ReasonNone

	if upstreamFound && upstreamBareName != in.Branch.ShortName {
		b := upstreamShort
		base = &b
		reason = ReasonUpstream
	}

	if base == nil {
		if in.OriginHead != "" {
			if _, ok := findRef(in.Branches, in.RemoteBranches, in.OriginHead); ok {
				h := in.OriginHead
				base = &h
				reason = ReasonDefaultBranch
			}
		}
		if base == nil {
			for _, c := range in.Candidates {
				if _, ok := findRef(in.Branches, in.RemoteBranches, c); ok {
					cc := c
					base = &cc
					reason = ReasonDefaultBranch
					break
				}
			}
		}
	}

	candidates := []Candidate{}
	seen := make(map[string]bool)
	push := func(ref, kind string, r Reason) {
		if seen[ref] {
			return
		}
		seen[ref] = true
		candidates = append(candidates, Candidate{Ref: ref, Kind: kind, Reason: r})
	}

	if upstreamFound {
		push(upstreamRef.ShortName, upstreamRef.Kind, ReasonUpstream)
	}
	if in.OriginHead != "" {
		if r, ok := findRef(in.Branches, in.RemoteBranches, in.OriginHead); ok {
			push(in.OriginHead, r.Kind, ReasonDefaultBranch)
		}
	}
	for _, c := range in.Candidates {
		if r, ok := findRef(in.Branches, in.RemoteBranches, c); ok {
			push(c, r.Kind, ReasonDefaultBranch)
		}
	}
	for _, r := range in.Branches {
		if r.IsHead {
			push(r.ShortName, r.Kind, ReasonDefaultBranch)
			break
		}
	}

	return Core{Base: base, Reason: reason, Candidates: candidates}
}
