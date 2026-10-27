package github

import (
	"context"
	"slices"
	"strings"
	"testing"
)

// TestReviewArgv guards the `-F` file-read hazard: a body starting with @ must travel via `-f`.
func TestReviewArgv(t *testing.T) {
	ctx := context.Background()
	sha := strings.Repeat("a", 40)

	runner := &recordingRunner{}
	c := testClient(t, runner)
	if s := c.SubmitReview(ctx, testRepo, 7, "approve", "", sha); !s.OK() {
		t.Fatalf("approve status = %+v", s)
	}
	for _, a := range runner.lastArgs {
		if strings.HasPrefix(a, "body=") {
			t.Fatalf("approve argv has a body field: %v", runner.lastArgs)
		}
	}

	if s := c.SubmitReview(ctx, testRepo, 7, "requestChanges", "@alice fix this", sha); !s.OK() {
		t.Fatalf("request changes status = %+v", s)
	}
	args := runner.lastArgs
	if slices.Contains(args, "-F") {
		t.Fatalf("argv uses -F: %v", args)
	}
	for _, want := range []string{"body=@alice fix this", "event=REQUEST_CHANGES", "commit_id=" + sha} {
		i := slices.Index(args, want)
		if i < 1 || args[i-1] != "-f" {
			t.Fatalf("argv lacks -f %q: %v", want, args)
		}
	}

	if s := c.CommentOnPull(ctx, testRepo, 7, "@bob thanks"); !s.OK() {
		t.Fatalf("comment status = %+v", s)
	}
	args = runner.lastArgs
	n := len(args)
	if args[n-3] != "repos/o/r/issues/7/comments" || args[n-2] != "-f" || args[n-1] != "body=@bob thanks" {
		t.Fatalf("comment argv tail = %v", args)
	}
}
