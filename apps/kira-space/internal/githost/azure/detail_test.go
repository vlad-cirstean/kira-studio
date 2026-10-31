package azure

import (
	"encoding/json"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

func TestMapDetail(t *testing.T) {
	var raw rawPRDetail
	var pol []rawPolicyDetail
	var th rawThreads
	for name, dst := range map[string]any{"pr_detail.json": &raw, "policy_detail.json": &pol, "threads_get.json": &th} {
		if err := json.Unmarshal(fixture(t, name), dst); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	d := mapDetail(testRepo, raw, pol, th)

	if d.Number != 12 || d.Author.Login != "ann@example.com" || d.Author.Name != "Ann Lee" || d.Stats != nil ||
		d.Mergeable != githost.MergeableConflict || d.ChecksState != "FAILURE" || d.ReviewDecision != "CHANGES_REQUESTED" {
		t.Errorf("base fields: %+v", d)
	}
	if len(d.Assignees) != 0 || len(d.Labels) != 2 || d.Labels[0].Name != "backend" || d.Labels[0].Color != "" {
		t.Errorf("labels/assignees: %+v %+v", d.Labels, d.Assignees)
	}

	wantVotes := []string{githost.ReviewerApproved, githost.ReviewerPending, githost.ReviewerChangesRequested, githost.ReviewerRejected}
	for i, w := range wantVotes {
		if d.Reviewers[i].State != w {
			t.Errorf("reviewer %d state %q, want %q", i, d.Reviewers[i].State, w)
		}
	}
	if !d.Reviewers[1].Team || !d.Reviewers[0].Required {
		t.Errorf("reviewers: %+v", d.Reviewers)
	}

	// Reviewer policy drops; names fall back statusName, build, type.
	if len(d.Checks) != 3 {
		t.Fatalf("checks: %+v", d.Checks)
	}
	c0, c1, c2 := d.Checks[0], d.Checks[1], d.Checks[2]
	if c0.Name != "CI build" || c0.State != githost.CheckFailure || !c0.Required ||
		c0.URL != "https://dev.azure.com/acme/Web%20App/_build/results?buildId=4821" {
		t.Errorf("build check: %+v", c0)
	}
	if c1.Name != "sonar" || c1.State != githost.CheckPending || c1.URL != "" {
		t.Errorf("status check: %+v", c1)
	}
	if c2.Name != "ci-docs" || c2.State != githost.CheckSkipped {
		t.Errorf("notApplicable check: %+v", c2)
	}

	// Thread 3 holds only system comments and drops; the deleted comment drops.
	if len(d.Threads) != 2 {
		t.Fatalf("threads: %+v", d.Threads)
	}
	general, code := d.Threads[0], d.Threads[1]
	if general.Kind != githost.ThreadComment || len(general.Comments) != 2 || general.Resolved ||
		general.Comments[0].ID != "1/1" || general.Comments[0].UpdatedAt == 0 || general.Comments[1].UpdatedAt != 0 {
		t.Errorf("general thread: %+v", general)
	}
	if code.Kind != githost.ThreadCode || code.Line != 14 || code.Path != "/src/login.go" || !code.Resolved {
		t.Errorf("code thread (left line fallback, fixed = resolved): %+v", code)
	}
	if d.ThreadsTruncated {
		t.Error("total 3 must not truncate")
	}

	th.Total = ThreadsRead + 1
	if !mapDetail(testRepo, raw, pol, th).ThreadsTruncated {
		t.Error("total above the read slice must truncate")
	}
}
