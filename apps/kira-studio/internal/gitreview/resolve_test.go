package gitreview

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func ref(shortName, kind string, isHead bool) porcelain.RefRow {
	return porcelain.RefRow{ShortName: shortName, Kind: kind, IsHead: isHead}
}

func ptr(s string) *string { return &s }

func TestResolveBase(t *testing.T) {
	tests := []struct {
		name           string
		in             Input
		wantBase       *string
		wantReason     Reason
		wantCandidates []Candidate
	}{
		{
			// originHead ("origin/main") does not itself resolve in this snapshot (no such remote
			// branch), so rule 1's same-name rejection falls all the way through to the first
			// existing Candidates member.
			name: "same-name upstream falls through to default branch",
			in: Input{
				Branch:         porcelain.RefRow{ShortName: "feature-x", Upstream: ptr("refs/remotes/origin/feature-x")},
				Branches:       []porcelain.RefRow{ref("feature-x", "branch", false), ref("main", "branch", true)},
				RemoteBranches: []porcelain.RefRow{ref("origin/feature-x", "remoteBranch", false)},
				OriginHead:     "origin/main",
				Candidates:     []string{"main", "master"},
			},
			wantBase:   ptr("main"),
			wantReason: ReasonDefaultBranch,
			wantCandidates: []Candidate{
				{Ref: "origin/feature-x", Kind: "remoteBranch", Reason: ReasonUpstream},
				{Ref: "main", Kind: "branch", Reason: ReasonDefaultBranch},
			},
		},
		{
			name: "different-name upstream is honoured",
			in: Input{
				Branch:         porcelain.RefRow{ShortName: "feature-x", Upstream: ptr("refs/remotes/origin/develop")},
				Branches:       []porcelain.RefRow{ref("feature-x", "branch", false)},
				RemoteBranches: []porcelain.RefRow{ref("origin/develop", "remoteBranch", false)},
				OriginHead:     "",
				Candidates:     nil,
			},
			wantBase:   ptr("origin/develop"),
			wantReason: ReasonUpstream,
			wantCandidates: []Candidate{
				{Ref: "origin/develop", Kind: "remoteBranch", Reason: ReasonUpstream},
			},
		},
		{
			name: "a local upstream (refs/heads/main) is honoured",
			in: Input{
				Branch:     porcelain.RefRow{ShortName: "feature-x", Upstream: ptr("refs/heads/main")},
				Branches:   []porcelain.RefRow{ref("feature-x", "branch", false), ref("main", "branch", false)},
				OriginHead: "",
			},
			wantBase:   ptr("main"),
			wantReason: ReasonUpstream,
			wantCandidates: []Candidate{
				{Ref: "main", Kind: "branch", Reason: ReasonUpstream},
			},
		},
		{
			name: "a gone upstream whose ref is no longer in the snapshot falls through",
			in: Input{
				Branch:     porcelain.RefRow{ShortName: "feature-x", Upstream: ptr("refs/remotes/origin/gone")},
				Branches:   []porcelain.RefRow{ref("feature-x", "branch", false)},
				OriginHead: "",
				Candidates: []string{"main"},
			},
			wantBase:       nil,
			wantReason:     ReasonNone,
			wantCandidates: []Candidate{},
		},
		{
			name: "originHead present and resolving",
			in: Input{
				Branch:         porcelain.RefRow{ShortName: "feature-x"},
				Branches:       []porcelain.RefRow{ref("feature-x", "branch", false)},
				RemoteBranches: []porcelain.RefRow{ref("origin/main", "remoteBranch", false)},
				OriginHead:     "origin/main",
			},
			wantBase:   ptr("origin/main"),
			wantReason: ReasonDefaultBranch,
			wantCandidates: []Candidate{
				{Ref: "origin/main", Kind: "remoteBranch", Reason: ReasonDefaultBranch},
			},
		},
		{
			name: "originHead absent falls through to candidates",
			in: Input{
				Branch:     porcelain.RefRow{ShortName: "feature-x"},
				Branches:   []porcelain.RefRow{ref("feature-x", "branch", false), ref("master", "branch", false)},
				OriginHead: "",
				Candidates: []string{"main", "master"},
			},
			wantBase:   ptr("master"),
			wantReason: ReasonDefaultBranch,
			wantCandidates: []Candidate{
				{Ref: "master", Kind: "branch", Reason: ReasonDefaultBranch},
			},
		},
		{
			name: "originHead present but dangling (probe P1) falls through to candidates",
			in: Input{
				Branch:     porcelain.RefRow{ShortName: "feature-x"},
				Branches:   []porcelain.RefRow{ref("feature-x", "branch", false), ref("main", "branch", false)},
				OriginHead: "origin/nonexistent",
				Candidates: []string{"main"},
			},
			wantBase:   ptr("main"),
			wantReason: ReasonDefaultBranch,
			wantCandidates: []Candidate{
				{Ref: "main", Kind: "branch", Reason: ReasonDefaultBranch},
			},
		},
		{
			name: "each candidates member present is picked in configured order",
			in: Input{
				Branch:     porcelain.RefRow{ShortName: "feature-x"},
				Branches:   []porcelain.RefRow{ref("feature-x", "branch", false), ref("develop", "branch", false), ref("master", "branch", false)},
				OriginHead: "",
				Candidates: []string{"main", "develop", "master"},
			},
			wantBase:   ptr("develop"),
			wantReason: ReasonDefaultBranch,
			wantCandidates: []Candidate{
				{Ref: "develop", Kind: "branch", Reason: ReasonDefaultBranch},
				{Ref: "master", Kind: "branch", Reason: ReasonDefaultBranch},
			},
		},
		{
			name: "candidates member absent from the snapshot is skipped",
			in: Input{
				Branch:     porcelain.RefRow{ShortName: "feature-x"},
				Branches:   []porcelain.RefRow{ref("feature-x", "branch", false)},
				OriginHead: "",
				Candidates: []string{"main", "master"},
			},
			wantBase:       nil,
			wantReason:     ReasonNone,
			wantCandidates: []Candidate{},
		},
		{
			name: "a repository with no branches at all resolves to none",
			in: Input{
				Branch:     porcelain.RefRow{ShortName: "feature-x"},
				Branches:   nil,
				OriginHead: "",
				Candidates: nil,
			},
			wantBase:       nil,
			wantReason:     ReasonNone,
			wantCandidates: []Candidate{},
		},
		{
			name: "candidate ordering and de-duplication: upstream first even when rejected for same-name, then originHead, then candidates, then HEAD",
			in: Input{
				Branch:         porcelain.RefRow{ShortName: "feature-x", Upstream: ptr("refs/remotes/origin/feature-x")},
				Branches:       []porcelain.RefRow{ref("feature-x", "branch", false), ref("main", "branch", true), ref("develop", "branch", false)},
				RemoteBranches: []porcelain.RefRow{ref("origin/feature-x", "remoteBranch", false), ref("origin/main", "remoteBranch", false)},
				OriginHead:     "origin/main",
				Candidates:     []string{"main", "develop"},
			},
			wantBase:   ptr("origin/main"),
			wantReason: ReasonDefaultBranch,
			wantCandidates: []Candidate{
				{Ref: "origin/feature-x", Kind: "remoteBranch", Reason: ReasonUpstream},
				{Ref: "origin/main", Kind: "remoteBranch", Reason: ReasonDefaultBranch},
				// "main" and "develop" come from Candidates, in configured order; the HEAD branch
				// ("main") is de-duplicated away since it was already pushed here.
				{Ref: "main", Kind: "branch", Reason: ReasonDefaultBranch},
				{Ref: "develop", Kind: "branch", Reason: ReasonDefaultBranch},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveBase(tt.in)
			if (got.Base == nil) != (tt.wantBase == nil) || (got.Base != nil && *got.Base != *tt.wantBase) {
				t.Errorf("Base = %v, want %v", derefOrNil(got.Base), derefOrNil(tt.wantBase))
			}
			if got.Reason != tt.wantReason {
				t.Errorf("Reason = %q, want %q", got.Reason, tt.wantReason)
			}
			if !reflect.DeepEqual(got.Candidates, tt.wantCandidates) {
				t.Errorf("Candidates = %+v, want %+v", got.Candidates, tt.wantCandidates)
			}
		})
	}
}

func derefOrNil(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}
