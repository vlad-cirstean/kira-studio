package gitpreflight

import (
	"log/slog"
	"strings"
)

// ProtectedMatch is MatchProtectedBranch's own result — the matched PATTERN, never a bare bool
// (D17), so a dialog can say "release/1.2 matches your protected pattern release/*".
type ProtectedMatch struct {
	Pattern string
}

// MatchProtectedBranch is D17's glob matcher, ported verbatim from upstream's
// model/protectedBranch.ts: `*` matches any run of characters except `/` (so `release/*` covers
// `release/1.2` but not `release/1.2/hotfix` or `releases/1.2`); anything else in the pattern is
// literal. Case-sensitive — git refnames are. `**` is not a supported glob — it is matched
// LITERALLY and reported once at warn (the setting is server-owned, D16, so a bad value is entered
// in Kira Studio's own settings dialog, not somewhere upstream's client-side "settings problem"
// channel could surface it instead). Returns the first pattern branch matches, or nil.
func MatchProtectedBranch(branch string, patterns []string) *ProtectedMatch {
	for _, pattern := range patterns {
		if strings.Contains(pattern, "**") {
			slog.Warn("gitpreflight: protected-branch pattern uses an unsupported '**' glob; matched literally",
				"scope", "gitpreflight", "pattern", pattern)
			if branch == pattern {
				return &ProtectedMatch{Pattern: pattern}
			}
			continue
		}
		if matchProtectedGlob(branch, pattern) {
			return &ProtectedMatch{Pattern: pattern}
		}
	}
	return nil
}

// matchProtectedGlob is an explicit segment walk (D17), not path.Match (whose `*` also stops at
// `/` but whose `[`/`?`/`\` semantics differ from upstream's) and not a regexp built per call:
// branch and pattern are split on `/` first — `*` can never cross that boundary anyway, so a
// per-segment match is exactly equivalent to a whole-string one — then each segment pair is
// matched with the classic two-pointer wildcard algorithm.
func matchProtectedGlob(branch, pattern string) bool {
	branchSegs := strings.Split(branch, "/")
	patternSegs := strings.Split(pattern, "/")
	if len(branchSegs) != len(patternSegs) {
		return false
	}
	for i := range branchSegs {
		if !matchSegmentGlob(branchSegs[i], patternSegs[i]) {
			return false
		}
	}
	return true
}

// matchSegmentGlob matches one path segment against one pattern segment — safe to treat `*` as an
// ordinary wildcard here since neither side can contain `/` (both already split on it).
func matchSegmentGlob(s, pattern string) bool {
	si, pi := 0, 0
	starIdx, starMatch := -1, 0
	for si < len(s) {
		switch {
		case pi < len(pattern) && pattern[pi] == s[si]:
			si++
			pi++
		case pi < len(pattern) && pattern[pi] == '*':
			starIdx = pi
			starMatch = si
			pi++
		case starIdx != -1:
			pi = starIdx + 1
			starMatch++
			si = starMatch
		default:
			return false
		}
	}
	for pi < len(pattern) && pattern[pi] == '*' {
		pi++
	}
	return pi == len(pattern)
}

// PushPreflight mirrors @kira/git-ipc's own PushPreflight field for field (D5's encoding rule).
type PushPreflight struct {
	Upstream         *string `json:"upstream"`
	WouldSetUpstream bool    `json:"wouldSetUpstream"`
	Ahead            int     `json:"ahead"`
	Behind           int     `json:"behind"`
	RemoteTip        *string `json:"remoteTip"`
	ProtectedBy      *string `json:"protectedBy"`
	FastForward      bool    `json:"fastForward"`
}

// ClassifyPushInput is ClassifyPush's own input — gitsession gathers these (the remote-tracking
// ref's own existence and sha stand in for "upstream" here, F15: "a branch with no upstream, or
// one whose remote-tracking ref has been pruned, is the common case" — both collapse to Upstream/
// RemoteTip being nil for this specific remote+branch pair).
type ClassifyPushInput struct {
	Branch            string
	Upstream          *string
	Ahead, Behind     int
	RemoteTip         *string
	ProtectedBranches []string
}

// ClassifyPush is §7.4's push classifier, ported from preflight/push.ts's own classifyPush.
func ClassifyPush(in ClassifyPushInput) PushPreflight {
	var protectedBy *string
	if match := MatchProtectedBranch(in.Branch, in.ProtectedBranches); match != nil {
		p := match.Pattern
		protectedBy = &p
	}
	return PushPreflight{
		Upstream: in.Upstream, WouldSetUpstream: in.Upstream == nil,
		Ahead: in.Ahead, Behind: in.Behind, RemoteTip: in.RemoteTip,
		ProtectedBy: protectedBy, FastForward: in.Behind == 0,
	}
}
