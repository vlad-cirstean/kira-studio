package githostflow_test

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeacli"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeaz"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakehost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost/azure"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/issuetracker/jira"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/oplog"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeclock"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// Contract host-view-comments: tests/ui/host-view-comments.spec.ts reads these.
const hcScenario = "host-view-comments"

// A real 1x1 PNG.
const hcPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

func hcPNGBytes(t *testing.T) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(hcPNG)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func hcB64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func hcOpen(t *testing.T, app *flowharness.App, url string) string {
	t.Helper()
	o, err := app.W.HostView.Open(ctx, bridge.HostViewOpenArgs{URL: url})
	if err != nil || !o.Opened {
		t.Fatalf("Open(%s) = %+v, %v", url, o, err)
	}
	return o.Key
}

func hcStage(t *testing.T, app *flowharness.App, key, name string, data []byte) bridge.HostViewStaged {
	t.Helper()
	got, err := app.W.HostView.StageAttachment(ctx, bridge.HostViewStageArgs{WindowKey: key, Name: name, Data: hcB64(data)})
	if err != nil {
		t.Fatalf("StageAttachment(%s) = %v", name, err)
	}
	return got
}

// hcBadRequest fails unless err is a bad request containing want.
func hcBadRequest(t *testing.T, err error, label, want string) {
	t.Helper()
	var ie *ipcerr.Error
	if err == nil || !errors.As(err, &ie) || ie.Code != string(ipcerr.CodeBadRequest) || !strings.Contains(err.Error(), want) {
		t.Errorf("%s: err = %v, want a bad request containing %q", label, err, want)
	}
}

func hcPost(t *testing.T, app *flowharness.App, a bridge.HostViewPostArgs) bridge.HostViewPosted {
	t.Helper()
	got, err := app.W.HostView.PostComment(ctx, a)
	if err != nil {
		t.Fatalf("PostComment(%+v) = %v", a, err)
	}
	return got
}

// Posting to the PR view over the in-process fake host: compose caps, staging and its refusals, a post
// with an attachment, a reply, the refetch, the breaker and the window close. Backend half of
// host-view-comments.spec.ts.
func TestHostViewCommentsForge(t *testing.T) {
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
	key := hcOpen(t, app, link)
	png := hcPNGBytes(t)

	// 1. The read result says what the composer may do.
	got := hvDetail(t, app, link)
	if got.Kind != bridge.HostViewOK || got.Compose == nil || !got.Compose.Attachments || got.Compose.MaxAttachments != 5 ||
		!slices.Equal(got.Compose.ReplyKinds, []string{"comment", "review", "code"}) {
		t.Fatalf("ChangeRequest compose = %+v", got.Compose)
	}
	app.Contract(t, hcScenario, "HostViewService.ChangeRequest#composeForge", got)

	// 2. Staging: accepted files, then every refusal.
	shot := hcStage(t, app, key, "shot.png", png)
	notes := hcStage(t, app, key, "notes.txt", []byte("hello\n"))
	if shot.ContentType != "image/png" || !shot.Image || shot.Size != len(png) || notes.Image || notes.ContentType != "text/plain" {
		t.Fatalf("staged = %+v, %+v", shot, notes)
	}
	app.Contract(t, hcScenario, "HostViewService.StageAttachment#png", shot, flowharness.Mask("id"))
	app.Contract(t, hcScenario, "args:HostViewService.StageAttachment", bridge.HostViewStageArgs{WindowKey: key, Name: "shot.png", Data: hcPNG}, flowharness.Mask("windowKey"))
	stage := func(name string, data []byte) error {
		_, err := app.W.HostView.StageAttachment(ctx, bridge.HostViewStageArgs{WindowKey: key, Name: name, Data: hcB64(data)})
		return err
	}
	hcBadRequest(t, stage("run.exe", []byte("MZ")), "exe", ".exe")
	hcBadRequest(t, stage("fake.png", []byte("not a png")), "png with text bytes", ".png")
	hcBadRequest(t, stage("page.txt", []byte("<html><body>x</body></html>")), "html in txt", ".txt")
	hcBadRequest(t, stage("empty.txt", nil), "empty", "empty")
	hcBadRequest(t, stage("..", []byte("x")), "dots", "name")
	hcBadRequest(t, stage("big.txt", make([]byte, 11<<20)), "11 MiB", "10 MB")
	_, err := app.W.HostView.StageAttachment(ctx, bridge.HostViewStageArgs{WindowKey: key, Name: "a.txt", Data: "***"})
	if err == nil || !strings.Contains(err.Error(), "base64") {
		t.Errorf("bad base64: err = %v", err)
	}
	_, err = app.W.HostView.StageAttachment(ctx, bridge.HostViewStageArgs{WindowKey: "no-such-window", Name: "a.txt", Data: hcB64([]byte("x"))})
	hcBadRequest(t, err, "unknown window", "can’t post")
	traversal := hcStage(t, app, key, "../x.png", png)
	if traversal.Name != "x.png" {
		t.Fatalf("sanitized name = %q, want x.png", traversal.Name)
	}
	dup := hcStage(t, app, key, "x.png", png)
	if dup.Name != "x-2.png" {
		t.Fatalf("duplicate name = %q, want x-2.png", dup.Name)
	}
	fifth := hcStage(t, app, key, "fifth.txt", []byte("x"))
	hcBadRequest(t, stage("sixth.txt", []byte("x")), "6th file", "at most 5")
	for _, id := range []string{traversal.ID, dup.ID, fifth.ID} {
		if ok, err := app.W.HostView.DiscardAttachment(ctx, bridge.HostViewDiscardArgs{WindowKey: key, ID: id}); err != nil || !ok {
			t.Fatalf("Discard(%s) = %v, %v", id, ok, err)
		}
	}

	// 3. Discard: true once, then false.
	dArgs := bridge.HostViewDiscardArgs{WindowKey: key, ID: notes.ID}
	if ok, err := app.W.HostView.DiscardAttachment(ctx, dArgs); err != nil || !ok {
		t.Fatalf("Discard = %v, %v", ok, err)
	}
	if ok, err := app.W.HostView.DiscardAttachment(ctx, dArgs); err != nil || ok {
		t.Fatalf("second Discard = %v, %v", ok, err)
	}

	// 4. A post with the PNG reaches the host with the staged bytes.
	pArgs := bridge.HostViewPostArgs{WindowKey: key, Body: "Looks good", AttachmentIDs: []string{shot.ID}}
	app.Contract(t, hcScenario, "args:HostViewService.PostComment", pArgs, flowharness.Mask("windowKey"), flowharness.Mask("attachmentIds"))
	res := hcPost(t, app, pArgs)
	if res.Kind != bridge.HostViewOK {
		t.Fatalf("PostComment = %+v", res)
	}
	app.Contract(t, hcScenario, "HostViewService.PostComment#ok", res)
	sum := sha256.Sum256(png)
	posted := forge.Posted(12)
	want := fakehost.PostedAttachment{Name: "shot.png", ContentType: "image/png", Size: len(png), SHA256: hex.EncodeToString(sum[:])}
	if len(posted) != 1 || posted[0].Body != "Looks good" || posted[0].ReplyTo != "" || len(posted[0].Attachments) != 1 || posted[0].Attachments[0] != want {
		t.Fatalf("posted = %+v, want one comment with %+v", posted, want)
	}

	// 5. The file is consumed.
	_, err = app.W.HostView.PostComment(ctx, pArgs)
	hcBadRequest(t, err, "reused attachment", "no longer available")

	// 6. A reply targets a thread; an unknown thread is data.
	if res := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "Thanks", ReplyTo: "t1"}); res.Kind != bridge.HostViewOK {
		t.Fatalf("reply = %+v", res)
	}
	if p := forge.Posted(12); len(p) != 2 || p[1].ReplyTo != "t1" {
		t.Fatalf("posted after reply = %+v", p)
	}
	bad := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "Lost", ReplyTo: "nope"})
	if bad.Kind != bridge.HostViewUnavailable || bad.Status == nil || bad.Status.Reason != "no such thread" {
		t.Fatalf("reply to an unknown thread = %+v", bad)
	}
	app.Contract(t, hcScenario, "HostViewService.PostComment#unavailable", bad)

	// 7. A refetch shows both comments.
	after := hvDetail(t, app, link)
	var ids []string
	for _, th := range after.Detail.Threads {
		for _, c := range th.Comments {
			ids = append(ids, th.ID+"/"+c.ID)
		}
	}
	if !slices.Contains(ids, "posted-1/posted-1") || !slices.Contains(ids, "t1/posted-2") {
		t.Fatalf("thread comments after the posts = %v", ids)
	}

	// 8. A rate limit arms the breaker: the next post does not reach the host.
	forge.SetRateLimited(time.Now().Add(time.Hour))
	forge.ResetCalls()
	for range 2 {
		if r := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "again"}); r.Kind != bridge.HostViewUnavailable || r.Status == nil || !r.Status.RateLimited {
			t.Fatalf("limited post = %+v", r)
		}
	}
	if n := forge.Count("post:"); n != 1 {
		t.Fatalf("host reached %d times while limited, want once", n)
	}
	clock.Advance(2 * time.Hour)
	forge.SetRateLimited(time.Time{})

	// 9. Guards, then the window close.
	_, err = app.W.HostView.PostComment(ctx, bridge.HostViewPostArgs{WindowKey: key, Body: "  \n"})
	hcBadRequest(t, err, "empty body", "Write a comment")
	_, err = app.W.HostView.PostComment(ctx, bridge.HostViewPostArgs{WindowKey: key, Body: strings.Repeat("a", githost.MaxHostCommentBytes+1)})
	hcBadRequest(t, err, "long body", "at most")
	_, err = app.W.HostView.PostComment(ctx, bridge.HostViewPostArgs{WindowKey: key, Body: "x", ReplyTo: strings.Repeat("a", 257)})
	hcBadRequest(t, err, "long reply target", "reply target")
	_, err = app.W.HostView.PostComment(ctx, bridge.HostViewPostArgs{WindowKey: key, Body: "x", AttachmentIDs: []string{"a", "a"}})
	hcBadRequest(t, err, "duplicate ids", "twice")
	_, err = app.W.HostView.PostComment(ctx, bridge.HostViewPostArgs{WindowKey: "no-such-window", Body: "x"})
	hcBadRequest(t, err, "unknown window", "can’t post")
	left := hcStage(t, app, key, "left.txt", []byte("x"))
	app.W.HostView.Attachments.Forget(key)
	_, err = app.W.HostView.PostComment(ctx, bridge.HostViewPostArgs{WindowKey: key, Body: "x", AttachmentIDs: []string{left.ID}})
	hcBadRequest(t, err, "staged file after the window closed", "no longer available")
}

// Posting over az: attachments upload over HTTPS with an az-issued token, then ride as links in the
// thread. Backend half of host-view-comments.spec.ts.
func TestHostViewCommentsAzure(t *testing.T) {
	az := fakeaz.New()
	az.SetDefaults("https://dev.azure.com/acme", "Web App")
	az.AddPR(azKey, fakeaz.PR{
		ID: 12, Title: "PROJ-7 Add login", Status: "active", Src: "feature/login", Dst: "main", Head: strings.Repeat("a", 40),
		Created: day(3), Author: "ann@example.com", AuthorName: "Ann Lee",
		Threads: []fakeaz.Thread{{ID: 1, Status: "active", Comments: []fakeaz.ThreadComment{
			{ID: 1, Author: "Bob Ray", Login: "bob@example.com", Body: "Add tests.", Published: "2026-05-03T11:00:00Z", LastUpdate: "2026-05-03T11:00:00Z"}}}},
	})
	clock := &azClock{now: time.Now()}
	app := flowharness.New(t, flowharness.WithoutGh(),
		flowharness.WithAzure(azure.Options{Locator: az, Runner: az, Clock: clock, HTTP: az.Transport()}))
	key := hcOpen(t, app, azPR12)
	png := hcPNGBytes(t)
	sum := sha256.Sum256(png)
	tokenCalls := func() int { return az.Count("token") }

	// 1. Upload then thread, in that order; the thread ends with the image link.
	got := hvDetail(t, app, azPR12)
	if got.Compose == nil || !got.Compose.Attachments || !slices.Equal(got.Compose.ReplyKinds, []string{"comment", "code"}) {
		t.Fatalf("compose = %+v", got.Compose)
	}
	shot := hcStage(t, app, key, "shot.png", png)
	az.ResetCalls()
	res := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "see this", AttachmentIDs: []string{shot.ID}})
	if res.Kind != bridge.HostViewOK {
		t.Fatalf("PostComment = %+v", res)
	}
	app.Contract(t, hcScenario, "HostViewService.PostComment#azure", res)
	var order []string
	for _, c := range az.Calls() {
		if c == "token" || strings.HasPrefix(c, "upload:") || strings.HasPrefix(c, "invoke:pullRequestThreads:") {
			order = append(order, c)
		}
	}
	if len(order) != 3 || order[0] != "token" || !regexp.MustCompile(`^upload:12:[0-9a-f]{8}-shot\.png$`).MatchString(order[1]) ||
		order[2] != "invoke:pullRequestThreads:"+azKey {
		t.Fatalf("calls = %v", order)
	}
	threads := az.Threads(12)
	linkRe := regexp.MustCompile(`\n\n!\[shot\.png\]\(https://dev\.azure\.com/acme/Web%20App/_apis/git/repositories/api/pullRequests/12/attachments/[0-9a-f]{8}-shot\.png\)$`)
	if len(threads) != 1 || !strings.HasPrefix(threads[0], "see this") || !linkRe.MatchString(threads[0]) {
		t.Fatalf("threads = %q", threads)
	}
	if up := az.Uploads(12); len(up) != 1 || up[0].Size != len(png) || up[0].SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatalf("uploads = %+v", up)
	}

	// 2. A reply goes into the thread under its first comment; no token without attachments.
	before := tokenCalls()
	if r := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "Done", ReplyTo: "1"}); r.Kind != bridge.HostViewOK {
		t.Fatalf("reply = %+v", r)
	}
	if rep := az.Replies(12); len(rep) != 1 || rep[0] != (fakeaz.Reply{ThreadID: 1, ParentCommentID: 1, Content: "Done"}) {
		t.Fatalf("replies = %+v", rep)
	}
	if az.Count("invoke:pullRequestThreadComments:"+azKey+":1") != 1 || tokenCalls() != before {
		t.Fatalf("calls = %v", az.Calls())
	}
	if r := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "plain"}); r.Kind != bridge.HostViewOK || tokenCalls() != before {
		t.Fatalf("plain post = %+v, token calls %d -> %d", r, before, tokenCalls())
	}

	// 3. A PAT-only sign-in has no token: unavailable with the reason; nothing uploaded; the staged file survives.
	threadsBefore := len(az.Threads(12))
	again := hcStage(t, app, key, "again.png", png)
	az.SetTokenUnavailable(true)
	aArgs := bridge.HostViewPostArgs{WindowKey: key, Body: "with file", AttachmentIDs: []string{again.ID}}
	noTok := hcPost(t, app, aArgs)
	if noTok.Kind != bridge.HostViewUnavailable || noTok.Status == nil || !strings.Contains(noTok.Status.Reason, "az login") ||
		az.Count("upload:") != 1 || len(az.Threads(12)) != threadsBefore {
		t.Fatalf("no token: %+v, uploads %d", noTok, az.Count("upload:"))
	}
	app.Contract(t, hcScenario, "HostViewService.PostComment#azureSignIn", noTok)
	az.SetTokenUnavailable(false)

	// 4. A refused upload posts nothing; the retry sends the same file.
	az.SetUploadStatus(413)
	big := hcPost(t, app, aArgs)
	if big.Kind != bridge.HostViewUnavailable || big.Status == nil || !strings.Contains(big.Status.Reason, "too large") || len(az.Threads(12)) != threadsBefore {
		t.Fatalf("413 = %+v", big)
	}
	if r := hcPost(t, app, aArgs); r.Kind != bridge.HostViewOK || len(az.Threads(12)) != threadsBefore+1 {
		t.Fatalf("retry = %+v", r)
	}

	// 5. A failed thread post removes the uploaded file again.
	last := hcStage(t, app, key, "last.png", png)
	az.SetFailure("ERROR: something broke")
	az.ResetCalls()
	fail := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "doomed", AttachmentIDs: []string{last.ID}})
	if fail.Kind != bridge.HostViewUnavailable || az.Count("upload:") != 1 || az.Count("delete:12:") != 1 {
		t.Fatalf("failed thread: %+v, calls %v", fail, az.Calls())
	}
	for _, u := range az.Uploads(12) {
		if strings.HasSuffix(u.Name, "-last.png") {
			t.Fatalf("uploaded file left behind: %+v", u)
		}
	}
	az.SetFailure("")

	if v := az.Violations(); len(v) != 0 {
		t.Fatalf("az contract violations: %v", v)
	}
}

func hcGhCalls(app *flowharness.App) int {
	files, _ := filepath.Glob(filepath.Join(app.FakeDir, "gh-*.args"))
	return len(files)
}

func hcLastGhArgs(t *testing.T, app *flowharness.App) []string {
	t.Helper()
	files, _ := filepath.Glob(filepath.Join(app.FakeDir, "gh-*.args"))
	n := func(p string) int {
		v, _ := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(filepath.Base(p), "gh-"), ".args"))
		return v
	}
	sort.Slice(files, func(i, j int) bool { return n(files[i]) < n(files[j]) })
	if len(files) == 0 {
		t.Fatal("gh was never called")
	}
	raw, err := os.ReadFile(files[len(files)-1])
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(string(raw), "\n")
}

// Posting over gh: no attachments, REST for a comment, GraphQL for a reply on a code thread.
func TestHostViewCommentsGitHub(t *testing.T) {
	fixture, err := filepath.Abs("../../githost/github/testdata/pr_detail.json")
	if err != nil {
		t.Fatal(err)
	}
	app := flowharness.New(t)
	emit := func(name, body string) string { return writeFile(t, filepath.Join(app.Work, name), body) }
	app.Scenario(fakeagent.Scenario{Gh: []fakeagent.GhRule{
		{Match: "--version", Emit: emit("version.txt", "gh version 2.42.0 (2024-01-08)\n")},
		{Match: "auth status", Emit: emit("auth.txt", "github.com\n  Logged in to github.com account octocat (keyring)\n")},
		{Match: "latestOpinionatedReviews", Emit: fixture},
		{Match: "issues/7/comments", Emit: emit("comment.json", `{"id":1}`)},
		{Match: "addPullRequestReviewThreadReply", Emit: emit("reply.json", `{"data":{"addPullRequestReviewThreadReply":{"comment":{"id":"C_1"}}}}`)},
	}})
	const link = "https://github.com/acme/api/pull/7"
	key := hcOpen(t, app, link)

	// 1. Attachments are unsupported, with the reason.
	got := hvDetail(t, app, link)
	if got.Compose == nil || got.Compose.Attachments || !strings.Contains(got.Compose.AttachmentsReason, "GitHub has no API") ||
		!slices.Equal(got.Compose.ReplyKinds, []string{"code"}) {
		t.Fatalf("compose = %+v", got.Compose)
	}
	app.Contract(t, hcScenario, "HostViewService.ChangeRequest#composeGitHub", got)

	// 2. Staging is refused with that reason.
	_, err = app.W.HostView.StageAttachment(ctx, bridge.HostViewStageArgs{WindowKey: key, Name: "a.txt", Data: hcB64([]byte("x"))})
	hcBadRequest(t, err, "stage", "GitHub has no API")

	// 3. A comment is a REST call; the body travels via -f.
	if r := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "hi @alice"}); r.Kind != bridge.HostViewOK {
		t.Fatalf("post = %+v", r)
	}
	args := hcLastGhArgs(t, app)
	if !slices.Contains(args, "repos/acme/api/issues/7/comments") {
		t.Fatalf("gh args = %q", args)
	}
	i := slices.Index(args, "-f")
	if i < 0 || args[i+1] != "body=hi @alice" || slices.Contains(args, "-F") {
		t.Fatalf("gh args = %q", args)
	}

	// 4. A reply on a code thread is GraphQL.
	if r := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "ok then", ReplyTo: "PRRT_abc"}); r.Kind != bridge.HostViewOK {
		t.Fatalf("reply = %+v", r)
	}
	args = hcLastGhArgs(t, app)
	joined := strings.Join(args, "\n")
	if !strings.Contains(joined, "addPullRequestReviewThreadReply") || !strings.Contains(joined, "\nthreadId=PRRT_abc") ||
		!strings.Contains(joined, "\nbody=ok then") || slices.Contains(args, "-F") {
		t.Fatalf("gh args = %q", args)
	}

	// 5. A thread id that is not a review thread never spawns gh.
	calls := hcGhCalls(app)
	bad := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "x", ReplyTo: "IC_kwDOabc"})
	if bad.Kind != bridge.HostViewUnavailable || bad.Status == nil || bad.Status.Reason != "no such thread" || hcGhCalls(app) != calls {
		t.Fatalf("reply to a comment thread = %+v, gh calls %d -> %d", bad, calls, hcGhCalls(app))
	}
}

// Posting to the issue view over acli: Markdown becomes ADF in a temp file, never argv.
func TestIssueComments(t *testing.T) {
	acli := fakeacli.New(ivSite)
	acli.SetIssue("PROJ-12", fakeacli.IssueJSON("PROJ-12", "Export report as CSV", "In Progress", "indeterminate", 0))
	acli.SetIssueDetail("PROJ-12", ivTestdata(t, "issue-detail.json"))
	clock := fakeclock.New(time.Now())
	app := flowharness.New(t, flowharness.WithGitHost(fakehost.New()), flowharness.WithoutGh(), flowharness.WithClock(clock),
		flowharness.WithIssueTracker(jira.Options{Locator: acli, Runner: acli, Clock: clock}))
	key := hcOpen(t, app, ivLink)

	// 1. Compose: no attachments, no replies, the Jira reason.
	got := ivIssue(t, app, ivLink)
	if got.Compose == nil || got.Compose.Attachments || len(got.Compose.ReplyKinds) != 0 || got.Compose.MaxBodyBytes != 32<<10 ||
		!strings.Contains(got.Compose.AttachmentsReason, "acli has no upload command") {
		t.Fatalf("compose = %+v", got.Compose)
	}
	app.Contract(t, hcScenario, "HostViewService.Issue#compose", got)

	// 2. The body lands as ADF in a file that is gone again.
	res := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "**Done** see https://x.test"})
	if res.Kind != bridge.HostViewOK {
		t.Fatalf("post = %+v", res)
	}
	app.Contract(t, hcScenario, "HostViewService.PostComment#issue", res)
	posted := acli.Posted("PROJ-12")
	if len(posted) != 1 {
		t.Fatalf("posted = %+v", posted)
	}
	var doc struct {
		Type    string `json:"type"`
		Version int    `json:"version"`
	}
	body := posted[0].Body
	if json.Unmarshal([]byte(body), &doc) != nil || doc.Type != "doc" || doc.Version != 1 ||
		!strings.Contains(body, `{"type":"strong"}`) || !strings.Contains(body, `"href":"https://x.test"`) {
		t.Fatalf("ADF body = %s", body)
	}
	if _, err := os.Stat(posted[0].Path); !os.IsNotExist(err) {
		t.Fatalf("temp body file still there: %v", err)
	}

	// 3. The op log row holds the file flag, not the text.
	rows, err := app.W.Ops.Recent(bridge.OpsRecentArgs{Limit: 200})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range rows {
		if r.Category == oplog.CategoryTracker && r.Command != nil && strings.Contains(*r.Command, "workitem comment") {
			found = true
			if !strings.Contains(*r.Command, "--body-file") || strings.Contains(*r.Command, "Done") {
				t.Fatalf("comment command = %q", *r.Command)
			}
		}
	}
	if !found {
		t.Fatalf("no workitem comment row in %d rows", len(rows))
	}

	// 4. Attachments and replies are refused.
	_, err = app.W.HostView.StageAttachment(ctx, bridge.HostViewStageArgs{WindowKey: key, Name: "a.txt", Data: hcB64([]byte("x"))})
	hcBadRequest(t, err, "stage", "acli has no upload command")
	_, err = app.W.HostView.PostComment(ctx, bridge.HostViewPostArgs{WindowKey: key, Body: "x", ReplyTo: "1"})
	hcBadRequest(t, err, "reply", "no replies")

	// 5. Signed out is data; an unknown key is gone.
	acli.SetLoggedIn(false)
	clock.Advance(6 * time.Minute)
	if r := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: key, Body: "x"}); r.Kind != bridge.HostViewUnavailable || r.Reason != "unauthenticated" {
		t.Fatalf("signed out post = %+v", r)
	}
	acli.SetLoggedIn(true)
	clock.Advance(6 * time.Minute)
	gone := hcOpen(t, app, "https://"+ivSite+"/browse/PROJ-99")
	if r := hcPost(t, app, bridge.HostViewPostArgs{WindowKey: gone, Body: "x"}); r.Kind != bridge.HostViewGone || r.Reason != "notFound" {
		t.Fatalf("unknown key post = %+v", r)
	}
}
