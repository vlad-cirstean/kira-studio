package ghclient

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

type scriptedRunner struct {
	calls   [][]string
	results []Result
}

func (r *scriptedRunner) Run(_ context.Context, _ string, spec Spec) (Result, error) {
	r.calls = append(r.calls, spec.Args)
	i := len(r.calls) - 1
	if i >= len(r.results) {
		i = len(r.results) - 1
	}
	return r.results[i], nil
}

func scriptedClient(results ...Result) (*Client, *scriptedRunner) {
	r := &scriptedRunner{results: results}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, okRunner(), &fakeClock{})
	return NewClient(d, r), r
}

func TestSetFilesViewed_ArgvGolden(t *testing.T) {
	c, r := scriptedClient(Result{Stdout: []byte(`{"data":{"m0":{"clientMutationId":null}}}`)})
	failed, status := c.SetFilesViewed(context.Background(), testRepo, "PR_1", []string{"@evil", "a b.go"}, true)
	if !status.OK() || len(failed) != 0 {
		t.Fatalf("status = %+v failed = %v", status, failed)
	}
	want := []string{
		"api", "graphql", "--hostname", "github.com",
		"-f", "query=mutation($pr:ID!,$p0:String!,$p1:String!){m0:markFileAsViewed(input:{pullRequestId:$pr,path:$p0}){clientMutationId} m1:markFileAsViewed(input:{pullRequestId:$pr,path:$p1}){clientMutationId} }",
		"-f", "pr=PR_1", "-f", "p0=@evil", "-f", "p1=a b.go",
	}
	if !reflect.DeepEqual(r.calls[0], want) {
		t.Fatalf("argv = %#v\nwant   %#v", r.calls[0], want)
	}

	c, r = scriptedClient(Result{Stdout: []byte(`{"data":{}}`)})
	if _, status := c.SetFilesViewed(context.Background(), testRepo, "PR_1", []string{"x"}, false); !status.OK() {
		t.Fatal(status)
	}
	if q := r.calls[0][5]; !strings.Contains(q, "unmarkFileAsViewed") {
		t.Fatalf("unmark query = %s", q)
	}
}

func TestSetFilesViewed_AliasErrorsAndChunks(t *testing.T) {
	body := `{"data":{"m0":{"clientMutationId":null},"m1":null},"errors":[{"message":"Could not resolve file","path":["m1"]}]}`
	c, r := scriptedClient(Result{ExitCode: 1, Stdout: []byte(body)})
	paths := make([]string, 0, 51)
	for i := 0; i < 51; i++ {
		paths = append(paths, fmt.Sprintf("f%d", i))
	}
	failed, status := c.SetFilesViewed(context.Background(), testRepo, "PR_1", paths, true)
	if !status.OK() {
		t.Fatalf("status = %+v", status)
	}
	if len(r.calls) != 2 {
		t.Fatalf("calls = %d, want 2 chunks (50 + 1)", len(r.calls))
	}
	if failed["f1"] != "Could not resolve file" || len(failed) != 1 {
		t.Fatalf("failed = %v, want only f1 (second chunk's m1 is out of range)", failed)
	}
}

func TestSetFilesViewed_WholeCallErrorFailsRemainingPaths(t *testing.T) {
	c, _ := scriptedClient(Result{ExitCode: 1, Stdout: []byte(`{"errors":[{"message":"API rate limit exceeded"}]}`)})
	failed, status := c.SetFilesViewed(context.Background(), testRepo, "PR_1", []string{"a", "b"}, true)
	if status.Kind != KindForbidden || !isRateLimited(status) || len(failed) != 2 {
		t.Fatalf("status = %+v failed = %v", status, failed)
	}
}

func TestPullFiles_Pagination(t *testing.T) {
	page1 := `{"data":{"repository":{"pullRequest":{"id":"PR_9","headRefOid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","state":"OPEN","files":{"nodes":[{"path":"a.go","viewerViewedState":"VIEWED"},{"path":"b.go","viewerViewedState":"UNVIEWED"}],"pageInfo":{"hasNextPage":true,"endCursor":"C1"}}}}}}`
	page2 := `{"data":{"repository":{"pullRequest":{"id":"PR_9","headRefOid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","state":"OPEN","files":{"nodes":[{"path":"c.go","viewerViewedState":"DISMISSED"}],"pageInfo":{"hasNextPage":false,"endCursor":"C2"}}}}}}`
	c, r := scriptedClient(Result{Stdout: []byte(page1)}, Result{Stdout: []byte(page2)})
	got, status := c.PullFiles(context.Background(), testRepo, 7)
	if !status.OK() {
		t.Fatal(status)
	}
	if got.NodeID != "PR_9" || got.HeadSha != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" || len(got.Files) != 3 || !got.Files[0].Viewed || got.Files[2].Viewed {
		t.Fatalf("got = %+v", got)
	}
	if len(r.calls) != 2 {
		t.Fatalf("calls = %d, want 2", len(r.calls))
	}
	tail := r.calls[1][len(r.calls[1])-2:]
	if !reflect.DeepEqual(tail, []string{"-f", "cursor=C1"}) {
		t.Fatalf("second page tail = %v", tail)
	}
	if !reflect.DeepEqual(r.calls[0][6:], []string{"-f", "owner=o", "-f", "name=r", "-F", "number=7"}) {
		t.Fatalf("first page vars = %v", r.calls[0][6:])
	}
}

func TestPullFiles_StopsOnPageWithoutProgress(t *testing.T) {
	oid := strings.Repeat("a", 40)
	page := `{"data":{"repository":{"pullRequest":{"id":"PR_9","headRefOid":"` + oid + `","state":"OPEN","files":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"C1"}}}}}}`
	c, r := scriptedClient(Result{Stdout: []byte(page)}, Result{Stdout: []byte(page)}, Result{Stdout: []byte(page)})
	got, status := c.PullFiles(context.Background(), testRepo, 7)
	if !status.OK() || !got.Truncated || len(r.calls) != 1 {
		t.Fatalf("status = %+v truncated = %v calls = %d, want 1 call and truncated", status, got.Truncated, len(r.calls))
	}
}

func TestPullFiles_RejectsMalformedHeadOid(t *testing.T) {
	page := `{"data":{"repository":{"pullRequest":{"id":"PR_9","headRefOid":"abc\nHEAD","state":"OPEN","files":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":""}}}}}}`
	c, _ := scriptedClient(Result{Stdout: []byte(page)})
	if _, status := c.PullFiles(context.Background(), testRepo, 7); status.OK() {
		t.Fatal("want a non-OK status for a malformed head oid")
	}
}

func TestPullFiles_TooLargeAndUnreadable(t *testing.T) {
	cases := []struct {
		name       string
		res        Result
		wantReason string
	}{
		{"truncated", Result{StdoutTruncated: true, Stdout: []byte(`{"data":{"repos`)}, tooLargeReason()},
		{"non-JSON exit 0", Result{Stdout: []byte("not json")}, reasonUnreadable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := scriptedClient(tc.res)
			_, status := c.PullFiles(context.Background(), testRepo, 1)
			if status.Kind != KindForbidden || status.Reason != tc.wantReason {
				t.Fatalf("status = %+v, want forbidden %q", status, tc.wantReason)
			}
		})
	}
}
