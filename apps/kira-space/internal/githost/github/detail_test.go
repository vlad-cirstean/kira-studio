package github

import (
	"context"
	"slices"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

func detailProvider(t *testing.T, stdout []byte) *Provider {
	t.Helper()
	return &Provider{client: testClient(t, &recordingRunner{result: Result{Stdout: stdout}})}
}

func TestChangeRequestDetail(t *testing.T) {
	p := detailProvider(t, readFixture(t, "pr_detail.json"))
	repo := githost.Repo{Host: "github.com", Owner: "acme", Name: "api"}
	d, s := p.ChangeRequestDetail(context.Background(), repo, 7)
	if !s.OK() {
		t.Fatalf("status %+v", s)
	}
	if d.State != "open" || d.ChecksState != "FAILURE" || d.Mergeable != githost.MergeableConflict ||
		d.Stats == nil || d.Stats.Commits != 3 || d.Stats.Files != 6 || d.ClosedAt != 0 {
		t.Errorf("base fields wrong: %+v", d)
	}

	want := map[string]struct {
		state    string
		required bool
		url      string
	}{
		"build": {githost.CheckSuccess, true, "https://ci.example/build/1"},
		"lint":  {githost.CheckFailure, false, ""}, // http URL dropped
		"e2e":   {githost.CheckPending, true, ""}, "deploy": {githost.CheckSkipped, false, ""},
		"docs": {githost.CheckNeutral, false, ""}, "action": {githost.CheckFailure, false, ""},
		"ci/legacy": {githost.CheckError, true, "https://legacy.example/1"},
		"ci/ok":     {githost.CheckSuccess, false, ""}, "ci/wait": {githost.CheckPending, false, ""},
	}
	if len(d.Checks) != len(want) || !d.ChecksTruncated {
		t.Fatalf("checks=%d truncated=%v", len(d.Checks), d.ChecksTruncated)
	}
	for _, c := range d.Checks {
		w := want[c.Name]
		if c.State != w.state || c.Required != w.required || c.URL != w.url {
			t.Errorf("check %s = %+v, want %+v", c.Name, c, w)
		}
	}

	got := map[string]githost.Reviewer{}
	for _, r := range d.Reviewers {
		got[r.Person.Login] = r
	}
	if len(d.Reviewers) != 4 || got["carol"].State != githost.ReviewerChangesRequested ||
		got["erin"].State != githost.ReviewerApproved || got["dave"].State != githost.ReviewerPending ||
		!got["platform"].Team || got["frank"].Person.Login != "" {
		t.Errorf("reviewers: %+v", d.Reviewers)
	}

	if len(d.Labels) != 2 || d.Labels[0].Color != "d73a4a" || d.Labels[1].Color != "" {
		t.Errorf("labels: %+v", d.Labels)
	}

	var ids []string
	byID := map[string]githost.Thread{}
	for _, th := range d.Threads {
		ids = append(ids, th.ID)
		byID[th.ID] = th
	}
	// R_2 (empty COMMENTED) drops; oldest first.
	if wantIDs := []string{"IC_1", "R_1", "RT_1", "RT_2", "IC_2", "R_3"}; !slices.Equal(ids, wantIDs) {
		t.Fatalf("threads %v, want %v", ids, wantIDs)
	}
	if !d.ThreadsTruncated {
		t.Error("comments totalCount above nodes must flag truncation")
	}
	if rt := byID["RT_1"]; rt.Line != 42 || rt.Path != "auth/login.go" || !rt.CommentsTruncated {
		t.Errorf("RT_1: %+v", rt)
	}
	if rt := byID["RT_2"]; rt.Line != 10 || !rt.Resolved || !rt.Outdated {
		t.Errorf("RT_2 must fall back to originalLine: %+v", rt)
	}
	if byID["R_1"].ReviewState != githost.ReviewerChangesRequested || byID["IC_2"].Comments[0].Author.Login != "ghost" {
		t.Errorf("review/ghost: %+v %+v", byID["R_1"], byID["IC_2"])
	}
}

func TestChangeRequestDetailGone(t *testing.T) {
	p := detailProvider(t, []byte(`{"data":{"repository":{"pullRequest":null}}}`))
	_, s := p.ChangeRequestDetail(context.Background(), githost.Repo{Host: "github.com", Owner: "acme", Name: "api"}, 9)
	if !s.Gone {
		t.Fatalf("status %+v", s)
	}
}
