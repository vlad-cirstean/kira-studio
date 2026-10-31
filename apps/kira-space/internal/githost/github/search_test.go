package github

import (
	"context"
	"reflect"
	"slices"
	"testing"
)

// searchRunner answers `gh search prs` with the all-results fixture, and the --merged variant with the
// merged one. The golden argv pins the flags `gh` accepts: gh has no head-branch field for search.
type searchRunner struct {
	t    *testing.T
	argv [][]string
}

func (r *searchRunner) Run(_ context.Context, _ string, spec Spec) (Result, error) {
	r.argv = append(r.argv, spec.Args)
	if slices.Contains(spec.Args, "--merged") {
		return Result{Stdout: readFixture(r.t, "search_prs_merged.json")}, nil
	}
	return Result{Stdout: readFixture(r.t, "search_prs.json")}, nil
}

func TestSearchPulls(t *testing.T) {
	runner := &searchRunner{t: t}
	c := NewClient(NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, okRunner(), &fakeClock{}), runner)

	prs, st := c.SearchPulls(context.Background(), "KIRA-12", 30)
	if !st.OK() {
		t.Fatalf("status %+v", st)
	}
	var got []string
	for _, p := range prs {
		got = append(got, p.URL+" "+p.State)
	}
	want := []string{
		"https://github.com/acme/web/pull/41 open",
		"https://github.com/acme/api/pull/40 merged",
		"https://github.com/acme/web/pull/39 draft",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
	wantArgv := []string{"search", "prs", `"KIRA-12"`, "--match", "title", "--sort", "updated", "--json", "number,title,state,url,isDraft", "--limit", "30"}
	if len(runner.argv) != 2 || !reflect.DeepEqual(runner.argv[0], wantArgv) || !reflect.DeepEqual(runner.argv[1], append(wantArgv, "--merged")) {
		t.Errorf("argv %v", runner.argv)
	}
}
