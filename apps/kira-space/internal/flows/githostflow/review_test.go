package githostflow_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakehost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
)

func TestChangeRequestReviewActions(t *testing.T) {
	forge := fakehost.New()
	r := newRig(t, forge)
	sha := flowharness.Replace(r.tip, strings.Repeat("a", 40))
	const scenario = "ade-review-actions"

	state := func() gitrpc.ChangeRequestReviewStateResult {
		return call[gitrpc.ChangeRequestReviewStateResult](t, r.gs, "changeRequest.reviewState",
			gitrpc.ChangeRequestReviewStateParams{RepoID: r.gitID, Branch: branch})
	}
	approve := func() gitrpc.ChangeRequestPostResult {
		return call[gitrpc.ChangeRequestPostResult](t, r.gs, "changeRequest.submitReview",
			gitrpc.ChangeRequestSubmitReviewParams{RepoID: r.gitID, Number: 7, Event: githost.ReviewApprove, Body: "LGTM\r\n", HeadSha: r.tip})
	}

	forge.SetAuthor(7, "alice")
	got := state()
	if got.Kind != "ok" || got.ChangeRequestReview == nil {
		t.Fatalf("reviewState = %+v", got)
	}
	rv := got.ChangeRequestReview
	if rv.Number != 7 || rv.Host.ID != "forge" || rv.State != "open" || rv.HeadSha != r.tip || rv.LocalHeadSha != r.tip ||
		rv.Author != "alice" || rv.Viewer != "forger" || rv.Own {
		t.Fatalf("reviewState ok payload = %+v", rv)
	}
	r.app.Contract(t, scenario, "git:changeRequest.reviewState", got, sha)

	posted := approve()
	if posted.Kind != "ok" {
		t.Fatalf("submitReview = %+v", posted)
	}
	want := []githost.Review{{Event: githost.ReviewApprove, Body: "LGTM", CommitSHA: r.tip}}
	if reviews := forge.Reviews(7); !reflect.DeepEqual(reviews, want) {
		t.Fatalf("Reviews = %+v, want %+v", reviews, want)
	}
	r.app.Contract(t, scenario, "git:changeRequest.submitReview", posted)

	commented := call[gitrpc.ChangeRequestPostResult](t, r.gs, "changeRequest.comment",
		gitrpc.ChangeRequestCommentParams{RepoID: r.gitID, Number: 7, Body: "@alice thanks"})
	if commented.Kind != "ok" {
		t.Fatalf("comment = %+v", commented)
	}
	if comments := forge.Comments(7); !reflect.DeepEqual(comments, []string{"@alice thanks"}) {
		t.Fatalf("Comments = %v", comments)
	}
	r.app.Contract(t, scenario, "git:changeRequest.comment", commented)

	forge.SetAuthor(7, "forger")
	own := state()
	if own.Kind != "ok" || own.ChangeRequestReview == nil || !own.Own {
		t.Fatalf("own reviewState = %+v", own)
	}
	r.app.Contract(t, scenario, "git:changeRequest.reviewState#own", own, sha)
	refused := approve()
	if refused.Kind != "unavailable" || refused.Status == nil || refused.Status.Reason != "you cannot approve your own merge request" {
		t.Fatalf("own submitReview = %+v", refused)
	}
	r.app.Contract(t, scenario, "git:changeRequest.submitReview#own", refused)
	if n := len(forge.Reviews(7)); n != 1 {
		t.Fatalf("Reviews after refusal = %d, want 1", n)
	}

	forge.SetAuthor(7, "alice")
	hostHead := strings.Repeat("b", 40)
	forge.SetHead(7, hostHead)
	stale := state()
	if stale.Kind != "ok" || stale.ChangeRequestReview == nil {
		t.Fatalf("stale reviewState = %+v", stale)
	}
	if sv := stale.ChangeRequestReview; sv.HeadSha != hostHead || sv.LocalHeadSha != r.tip || sv.Own {
		t.Fatalf("stale payload = %+v", sv)
	}
	r.app.Contract(t, scenario, "git:changeRequest.reviewState#stale", stale, sha)
}
