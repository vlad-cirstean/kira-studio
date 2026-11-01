package githostflow_test

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeaz"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakehost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost/azure"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeclock"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// Contract host-view: tests/ui/host-view.spec.ts reads these.
const hvScenario = "host-view"

func hvDetail(t *testing.T, app *flowharness.App, url string) bridge.HostViewChangeRequest {
	t.Helper()
	got, err := app.W.HostView.ChangeRequest(ctx, bridge.HostViewChangeRequestArgs{URL: url})
	if err != nil {
		t.Fatalf("ChangeRequest(%s) = %v", url, err)
	}
	return got
}

// hvRefused fails unless Open and ChangeRequest both refuse url as a bad request naming label.
func hvRefused(t *testing.T, app *flowharness.App, url, label string) {
	t.Helper()
	_, errOpen := app.W.HostView.Open(ctx, bridge.HostViewOpenArgs{URL: url})
	_, errRead := app.W.HostView.ChangeRequest(ctx, bridge.HostViewChangeRequestArgs{URL: url})
	for _, err := range []error{errOpen, errRead} {
		if err == nil || !strings.Contains(err.Error(), label) {
			t.Errorf("%.40q: err = %v, want a refusal naming %q", url, err, label)
		}
		var ie *ipcerr.Error
		if !errors.As(err, &ie) || ie.Code != string(ipcerr.CodeBadRequest) {
			t.Errorf("%.40q: err = %v, want a bad request", url, err)
		}
	}
}

func hvDetailFixture() githost.ChangeRequestDetail {
	return githost.ChangeRequestDetail{
		CreatedAt: 1_700_000_000_000,
		Body:      "Rework **auth**.",
		Labels:    []githost.Label{{Name: "security", Color: "d73a4a"}},
		Reviewers: []githost.Reviewer{{Person: githost.Person{Login: "bob"}, State: githost.ReviewerApproved, Required: true}},
		Checks: []githost.Check{
			{Name: "build", State: githost.CheckSuccess, URL: "https://ci.forge.test/1", Required: true},
			{Name: "lint", State: githost.CheckFailure},
		},
		Threads: []githost.Thread{
			{ID: "t2", Kind: githost.ThreadCode, Path: "auth.go", Line: 9, Comments: []githost.Comment{
				{ID: "c2", Author: githost.Person{Login: "bob"}, Body: "Why?", CreatedAt: 1_700_000_200_000}}},
			{ID: "t1", Kind: githost.ThreadComment, Comments: []githost.Comment{
				{ID: "c1", Author: githost.Person{Login: "ann"}, Body: "Ready.", CreatedAt: 1_700_000_100_000}}},
		},
	}
}

// The PR view over the in-process fake host: open or focus the window, read the detail, refuse
// non-pull-request links, and stop calling a rate limited host. Backend half of host-view.spec.ts.
func TestHostViewForge(t *testing.T) {
	forge := fakehost.New()
	forge.AddChangeRequest(githost.ChangeRequest{
		Number: 12, Title: "Rework auth", State: "open", HeadRef: "feat/auth", BaseRef: "main", HeadOwner: "acme",
		URL: "https://forge.test/acme/api/-/merge_requests/12", UpdatedAt: 1_700_000_300_000,
	})
	forge.SetAuthor(12, "ann")
	forge.SetDetail(12, hvDetailFixture())
	clock := fakeclock.New(time.Now())
	app := flowharness.New(t, flowharness.WithGitHost(forge), flowharness.WithoutGh(), flowharness.WithClock(clock))
	const link = "https://forge.test/acme/api/-/merge_requests/12"

	// Open: a new window with the PR title, then the same window focused, then a fresh one once the old is gone.
	opened, err := app.W.HostView.Open(ctx, bridge.HostViewOpenArgs{URL: link + "?tab=x"})
	if err != nil || !opened.Opened || !strings.HasPrefix(opened.Key, bridge.HostWindowKeyPrefix) {
		t.Fatalf("Open = %+v, %v", opened, err)
	}
	app.Contract(t, hvScenario, "HostViewService.Open#forge", opened, flowharness.Mask("key"))
	wm := app.WindowMgr
	if len(wm.Opened) != 1 || wm.Opened[0].Key != opened.Key || wm.Titles[opened.Key] != "MR #12 · acme/api" {
		t.Fatalf("window manager: opened %+v titles %v", wm.Opened, wm.Titles)
	}
	again, err := app.W.HostView.Open(ctx, bridge.HostViewOpenArgs{URL: link + "#note"})
	if err != nil || again.Opened || again.Key != opened.Key || !slices.Equal(wm.Focused, []string{opened.Key}) {
		t.Fatalf("second Open = %+v, %v; focused %v", again, err, wm.Focused)
	}
	delete(wm.Known, opened.Key)
	fresh, err := app.W.HostView.Open(ctx, bridge.HostViewOpenArgs{URL: link})
	if err != nil || !fresh.Opened || fresh.Key == opened.Key {
		t.Fatalf("Open after the window closed = %+v, %v", fresh, err)
	}

	// WindowTarget: the target for the key, null for any other.
	target, err := app.W.HostView.WindowTarget(ctx, bridge.HostViewWindowArgs{WindowKey: fresh.Key})
	if err != nil || target == nil || target.Kind != "changeRequest" || target.URL != link || target.Number != 12 ||
		target.Repo != "acme/api" || target.Host.Label != "Forge" || target.Provider != "forge" {
		t.Fatalf("WindowTarget = %+v, %v", target, err)
	}
	app.Contract(t, hvScenario, "HostViewService.WindowTarget#forge", target)
	if other, err := app.W.HostView.WindowTarget(ctx, bridge.HostViewWindowArgs{WindowKey: "not-a-window"}); err != nil || other != nil {
		t.Fatalf("WindowTarget(other) = %+v, %v", other, err)
	}

	// ChangeRequest: the stored detail with the host row and author laid over it.
	app.Contract(t, hvScenario, "args:HostViewService.ChangeRequest", bridge.HostViewChangeRequestArgs{URL: link})
	got := hvDetail(t, app, link)
	if got.Kind != bridge.HostViewOK || got.Detail == nil || got.Detail.Number != 12 || got.Detail.Title != "Rework auth" ||
		got.Detail.Author.Login != "ann" || len(got.Detail.Threads) != 2 || got.Detail.Threads[0].ID != "t1" {
		t.Fatalf("ChangeRequest = %+v", got)
	}
	app.Contract(t, hvScenario, "HostViewService.ChangeRequest#forge", got)

	// Refusals: an issue, a foreign host, an oversized link.
	for _, bad := range []string{
		"https://forge.test/acme/api/-/issues/3", "https://evil.test/acme/api/-/merge_requests/12",
		"https://forge.test/acme/api/-/merge_requests/12/" + strings.Repeat("a", 2100),
	} {
		hvRefused(t, app, bad, "Forge MR link")
	}

	// A rate limit arms the breaker for the repository until the reset time.
	forge.SetRateLimited(time.Now().Add(time.Hour))
	forge.ResetCalls()
	for range 2 {
		if got := hvDetail(t, app, link); got.Kind != bridge.HostViewUnavailable || !got.Status.RateLimited {
			t.Fatalf("limited ChangeRequest = %+v", got)
		}
	}
	if n := forge.Count("detail:"); n != 1 {
		t.Fatalf("host reached %d times while limited, want once", n)
	}
	clock.Advance(2 * time.Hour)
	forge.SetRateLimited(time.Time{})
	if got := hvDetail(t, app, link); got.Kind != bridge.HostViewOK || forge.Count("detail:") != 2 {
		t.Fatalf("after the reset: %+v, host calls %d", got, forge.Count("detail:"))
	}

	// A merge request the host dropped reads as gone.
	forge.RemoveChangeRequest(12)
	if got := hvDetail(t, app, link); got.Kind != bridge.HostViewGone || got.Detail != nil {
		t.Fatalf("removed ChangeRequest = %+v", got)
	}
}

func newHostViewAzure(t *testing.T) (*flowharness.App, *fakeaz.Az, *azClock) {
	t.Helper()
	az := fakeaz.New()
	az.SetDefaults("https://dev.azure.com/acme", "Web App")
	az.AddPR(azKey, fakeaz.PR{
		ID: 12, Title: "PROJ-7 Add login", Status: "active", Src: "feature/login", Dst: "main", Head: strings.Repeat("a", 40),
		Created: day(3), Author: "ann@example.com", AuthorName: "Ann Lee", MergeStatus: "succeeded",
		Description: "## Why\n\nAdds login.", Labels: []string{"backend"},
		Reviewers: []fakeaz.Reviewer{
			{Vote: 10, Required: true, Name: "Bob Ray", Login: "bob@example.com"},
			{Vote: -5, Name: "Cy Dee", Login: "cy@example.com"},
		},
		Policies: []fakeaz.Policy{
			{Type: "Build", Status: "rejected", Name: "CI build", Blocking: true, BuildID: 4821},
			{Type: "Minimum number of reviewers", Status: "approved"},
		},
		Threads: []fakeaz.Thread{
			{ID: 1, Status: "active", Comments: []fakeaz.ThreadComment{
				{ID: 1, Author: "Bob Ray", Login: "bob@example.com", Body: "Add tests.", Published: "2026-05-03T11:00:00Z", LastUpdate: "2026-05-03T11:00:00Z"},
				{ID: 2, Author: "Bob Ray", Login: "bob@example.com", Body: "Bob voted 10", Type: "system", Published: "2026-05-03T11:01:00Z", LastUpdate: "2026-05-03T11:01:00Z"}}},
			{ID: 2, Status: "fixed", Path: "/src/login.go", Right: 14, Comments: []fakeaz.ThreadComment{
				{ID: 1, Author: "Cy Dee", Login: "cy@example.com", Body: "Rename.", Published: "2026-05-03T12:00:00Z", LastUpdate: "2026-05-03T12:00:00Z"}}},
		},
	})
	clock := &azClock{now: time.Now()}
	app := flowharness.New(t, flowharness.WithAzure(azure.Options{Locator: az, Runner: az, Clock: clock}), flowharness.WithoutGh())
	return app, az, clock
}

// The PR view over az: three reads, the GET carries a projection and no body file, and every az
// failure is data in the result.
func TestHostViewAzure(t *testing.T) {
	app, az, clock := newHostViewAzure(t)
	const link = azPR12 + "?_a=files"

	opened, err := app.W.HostView.Open(ctx, bridge.HostViewOpenArgs{URL: link})
	if err != nil || !opened.Opened || app.WindowMgr.Titles[opened.Key] != "PR #12 · acme/Web App/api" {
		t.Fatalf("Open = %+v, %v; titles %v", opened, err, app.WindowMgr.Titles)
	}
	target, err := app.W.HostView.WindowTarget(ctx, bridge.HostViewWindowArgs{WindowKey: opened.Key})
	if err != nil || target == nil || target.URL != azPR12 || target.Host.Label != "Azure Repos" {
		t.Fatalf("WindowTarget = %+v, %v", target, err)
	}
	app.Contract(t, hvScenario, "HostViewService.WindowTarget#azure", target)

	got := hvDetail(t, app, link)
	d := got.Detail
	if got.Kind != bridge.HostViewOK || d == nil || d.Author.Name != "Ann Lee" || d.Body != "## Why\n\nAdds login." ||
		d.Stats != nil || d.Mergeable != githost.MergeableYes || d.ChecksState != "FAILURE" || len(d.Labels) != 1 ||
		len(d.Reviewers) != 2 || d.Reviewers[1].State != githost.ReviewerChangesRequested {
		t.Fatalf("ChangeRequest = %+v", got)
	}
	if len(d.Checks) != 1 || d.Checks[0].URL != "https://dev.azure.com/acme/Web%20App/_build/results?buildId=4821" || !d.Checks[0].Required {
		t.Fatalf("checks = %+v", d.Checks)
	}
	if len(d.Threads) != 2 || len(d.Threads[0].Comments) != 1 || d.Threads[1].Kind != githost.ThreadCode ||
		d.Threads[1].Line != 14 || !d.Threads[1].Resolved {
		t.Fatalf("threads = %+v", d.Threads)
	}
	app.Contract(t, hvScenario, "HostViewService.ChangeRequest#azure", got)
	if n := az.Count("invoke:GET:pullRequestThreads:12"); n != 1 {
		t.Fatalf("threads GET calls = %d, want 1", n)
	}

	// Work items and other hosts' links are not pull requests.
	hvRefused(t, app, "https://dev.azure.com/acme/Web%20App/_workitems/edit/55", "Azure Repos PR link")

	// An id the host does not know reads as gone.
	gone := hvDetail(t, app, strings.Replace(azPR12, "/12", "/99", 1))
	if gone.Kind != bridge.HostViewGone {
		t.Fatalf("unknown PR = %+v", gone)
	}
	app.Contract(t, hvScenario, "HostViewService.ChangeRequest#gone", gone)

	// Signed out: unavailable with the step that fixes it.
	az.SetLoggedIn(false)
	clock.Advance(6 * time.Minute)
	out := hvDetail(t, app, link)
	if out.Kind != bridge.HostViewUnavailable || out.Status.Kind != githost.KindUnauthenticated || !strings.Contains(out.Status.Reason, "az login") {
		t.Fatalf("signed out = %+v", out)
	}
	app.Contract(t, hvScenario, "HostViewService.ChangeRequest#unavailable", out)
	az.SetLoggedIn(true)
	clock.Advance(6 * time.Minute)

	// Throttled: the breaker keeps the next read from spawning az.
	az.SetFailure("ERROR: TF400733: The request has been canceled: Request was blocked due to exceeding usage of resource 'Count' in namespace 'WIT'.")
	if th := hvDetail(t, app, link); th.Kind != bridge.HostViewUnavailable || !th.Status.RateLimited {
		t.Fatalf("throttled = %+v", th)
	}
	shows := az.Count("pr-show:")
	if hvDetail(t, app, link).Kind != bridge.HostViewUnavailable || az.Count("pr-show:") != shows {
		t.Fatalf("a read inside the breaker window spawned az (pr-show %d -> %d)", shows, az.Count("pr-show:"))
	}
	if v := az.Violations(); len(v) != 0 {
		t.Fatalf("az contract violations: %v", v)
	}
}

// The PR view over gh: one GraphQL read.
func TestHostViewGitHub(t *testing.T) {
	fixture, err := filepath.Abs("../../githost/github/testdata/pr_detail.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, emit string
		kind       string
	}{
		{"detail", fixture, bridge.HostViewOK},
		{"gone", "", bridge.HostViewGone},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := flowharness.New(t)
			emit := tc.emit
			if emit == "" {
				emit = filepath.Join(app.Work, "null.json")
				writeFile(t, emit, `{"data":{"repository":{"pullRequest":null}}}`)
			}
			app.Scenario(fakeagent.Scenario{Gh: []fakeagent.GhRule{
				{Match: "--version", Emit: writeFile(t, filepath.Join(app.Work, "version.txt"), "gh version 2.42.0 (2024-01-08)\n")},
				{Match: "auth status", Emit: writeFile(t, filepath.Join(app.Work, "auth.txt"), "github.com\n  Logged in to github.com account octocat (keyring)\n")},
				{Match: "latestOpinionatedReviews", Emit: emit},
			}})
			const link = "https://github.com/acme/api/pull/7/files"

			if tc.kind == bridge.HostViewOK {
				opened, err := app.W.HostView.Open(ctx, bridge.HostViewOpenArgs{URL: link})
				if err != nil || !opened.Opened || app.WindowMgr.Titles[opened.Key] != "PR #7 · acme/api" {
					t.Fatalf("Open = %+v, %v; titles %v", opened, err, app.WindowMgr.Titles)
				}
				hvRefused(t, app, "https://github.com/acme/api/issues/7", "GitHub PR link")
			}
			got := hvDetail(t, app, link)
			if got.Kind != tc.kind {
				t.Fatalf("ChangeRequest = %+v, want kind %s", got, tc.kind)
			}
			if tc.kind == bridge.HostViewOK {
				d := got.Detail
				if d.Number != 7 || d.Author.Login != "alice" || d.Stats == nil || d.Stats.Files != 6 || len(d.Checks) != 9 || len(d.Threads) != 6 {
					t.Fatalf("detail = %+v", d)
				}
				app.Contract(t, hvScenario, "HostViewService.ChangeRequest#github", got)
			}
		})
	}
}

func writeFile(t *testing.T, path, content string) string {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}
