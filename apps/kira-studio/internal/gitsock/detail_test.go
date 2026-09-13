package gitsock

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// §7.1(e)'s own end-to-end proof: commit.detail, commit.fileDiff, file.read and file.goToTarget
// over a real socket against a real fixture repository — the phase's real proof.

// detailFixture names the commits buildDetailFixtureRepo's own topology produces, so each test
// can reach exactly the scenario it needs without re-deriving shas from git log output.
type detailFixture struct {
	dir string

	root       string // a.txt, root commit
	renameBase string // adds old.txt
	renamed    string // renames old.txt -> new.txt with a one-line edit (probe P1)
	binaryAdd  string
	binaryMod  string
	goneAdd    string
	goneDelete string
	modeBase   string
	modeChange string // chmod +x, no content change
	hugeBase   string
	hugeMod    string // a patch over gitsession.MaxPatchBytes

	newlinePathCommit string
	newlinePath       string // a path containing a literal newline (D10)

	trailerCommit string // a body with a real trailer paragraph

	branchA string
	branchB string
	merge   string // two parents: [branchB (mainline), branchA]

	signed string // SSH-signed via testdata/keys/fixtureSigningKey — "" if ssh-keygen is unavailable
}

func detailFixtureEnv() []string {
	return append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
	)
}

func buildDetailFixtureRepo(t *testing.T) detailFixture {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()

	run := func(args ...string) string {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = detailFixtureEnv()
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return string(out)
	}
	writeFile := func(name, content string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	commit := func(msg string) string {
		run("-c", "commit.gpgsign=false", "commit", "-q", "-m", msg, "--allow-empty-message")
		return trimNewline(run("rev-parse", "HEAD"))
	}

	run("init", "-q", "-b", "main")

	var f detailFixture
	f.dir = dir

	writeFile("a.txt", "a\n")
	run("add", "a.txt")
	f.root = commit("root commit")

	content := ""
	for i := 1; i <= 20; i++ {
		content += string(rune('0'+i%10)) + "\n"
	}
	writeFile("old.txt", content)
	run("add", "old.txt")
	f.renameBase = commit("add old.txt")

	run("mv", "old.txt", "new.txt")
	edited := ""
	for i := 1; i <= 20; i++ {
		if i == 5 {
			edited += "CHANGED\n"
		} else {
			edited += string(rune('0'+i%10)) + "\n"
		}
	}
	writeFile("new.txt", edited)
	run("add", "new.txt")
	f.renamed = commit("rename with edit")

	writeFile("bin.dat", "\x00\x01binary-v1")
	run("add", "bin.dat")
	f.binaryAdd = commit("add binary")
	writeFile("bin.dat", "\x00\x01binary-v2-longer-content")
	run("add", "bin.dat")
	f.binaryMod = commit("modify binary")

	writeFile("gone.txt", "will be deleted\n")
	run("add", "gone.txt")
	f.goneAdd = commit("add gone.txt")
	run("rm", "-q", "gone.txt")
	f.goneDelete = commit("delete gone.txt")

	writeFile("mode.txt", "hi\n")
	run("add", "mode.txt")
	f.modeBase = commit("add mode.txt")
	if err := os.Chmod(filepath.Join(dir, "mode.txt"), 0o755); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	run("add", "mode.txt")
	f.modeChange = commit("mode change")

	writeFile("huge.txt", strings.Repeat("line\n", 10))
	run("add", "huge.txt")
	f.hugeBase = commit("add huge.txt")
	// Over gitsession.MaxPatchBytes (1 MiB): ~700k short added lines, comfortably past the cap.
	writeFile("huge.txt", strings.Repeat("x\n", 700_000))
	run("add", "huge.txt")
	f.hugeMod = commit("rewrite huge.txt")

	newlineName := "weird\nname.txt"
	writeFile(newlineName, "newline path content\n")
	run("add", "-A")
	f.newlinePathCommit = commit("add newline-path file")
	f.newlinePath = newlineName

	writeFile("trailer.txt", "x\n")
	run("add", "trailer.txt")
	f.trailerCommit = commit("Subject with a trailer\n\nBody text.\n\nReviewed-by: Bob <bob@example.com>")

	run("branch", "feature-a")
	run("checkout", "-q", "feature-a")
	writeFile("a-feature.txt", "feature a\n")
	run("add", "a-feature.txt")
	f.branchA = commit("feature a work")
	run("checkout", "-q", "main")
	writeFile("b-feature.txt", "feature b\n")
	run("add", "b-feature.txt")
	f.branchB = commit("feature b work on main")
	run("-c", "commit.gpgsign=false", "merge", "-q", "--no-ff", "-m", "merge feature-a", "feature-a")
	f.merge = trimNewline(run("rev-parse", "HEAD"))

	if _, err := exec.LookPath("ssh-keygen"); err == nil {
		keyBytes, kerr := os.ReadFile(filepath.Join("testdata", "keys", "fixtureSigningKey"))
		if kerr != nil {
			t.Fatalf("read fixture signing key: %v", kerr)
		}
		keyPath := filepath.Join(t.TempDir(), "signingKey")
		if werr := os.WriteFile(keyPath, keyBytes, 0o600); werr != nil {
			t.Fatalf("write temp signing key: %v", werr)
		}
		writeFile("signed.txt", "signed content\n")
		run("add", "signed.txt")
		run("-c", "gpg.format=ssh", "-c", "user.signingkey="+keyPath, "-c", "commit.gpgsign=true",
			"commit", "-q", "-m", "signed commit")
		f.signed = trimNewline(run("rev-parse", "HEAD"))
	}

	return f
}

func unmarshalResult[T any](t *testing.T, raw json.RawMessage) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("unmarshal %T: %v\n%s", v, err, raw)
	}
	return v
}

func filePaths(files []porcelain.FileChange) []string {
	paths := make([]string, len(files))
	for i, f := range files {
		paths[i] = f.Path
	}
	return paths
}

func TestIntegration_CommitDetailAndFileTree(t *testing.T) {
	t.Parallel()
	f := buildDetailFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "detail-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	resp := requestOK(t, client, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.renamed})
	detail := unmarshalResult[porcelain.CommitDetail](t, resp.Result)

	if detail.SHA != f.renamed || detail.Subject != "rename with edit" {
		t.Fatalf("detail = %+v", detail)
	}
	if len(detail.Files) != 1 {
		t.Fatalf("files = %+v, want exactly one row", detail.Files)
	}
	fc := detail.Files[0]
	if fc.Kind != porcelain.FileRenamed || fc.Path != "new.txt" {
		t.Fatalf("file change = %+v, want a rename to new.txt", fc)
	}
	if fc.OriginalPath == nil || *fc.OriginalPath != "old.txt" {
		t.Fatalf("originalPath = %v, want old.txt", fc.OriginalPath)
	}
	if fc.Similarity == nil {
		t.Fatal("similarity not set on a rename row")
	}
	if fc.Additions == nil || *fc.Additions != 1 || fc.Deletions == nil || *fc.Deletions != 1 {
		t.Fatalf("additions/deletions = %v/%v, want the true +1 -1 (probe P1)", fc.Additions, fc.Deletions)
	}

	// The trailer commit proves body/trailers round-trip with the paragraph stripped server-side.
	respTrailer := requestOK(t, client, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.trailerCommit})
	trailerDetail := unmarshalResult[porcelain.CommitDetail](t, respTrailer.Result)
	if trailerDetail.Body != "Body text." {
		t.Fatalf("body = %q, want the trailer paragraph removed", trailerDetail.Body)
	}
	if len(trailerDetail.Trailers) != 1 || trailerDetail.Trailers[0].Token != "Reviewed-by" {
		t.Fatalf("trailers = %+v", trailerDetail.Trailers)
	}
	if trailerDetail.Signature.Status == "" {
		t.Fatal("signature status is empty")
	}

	if f.signed != "" {
		respSigned := requestOK(t, client, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.signed})
		signedDetail := unmarshalResult[porcelain.CommitDetail](t, respSigned.Result)
		if signedDetail.Signature.Status == "" {
			t.Fatal("signed commit's own signature status is empty")
		}
	}
}

func TestIntegration_CommitDetailMergeParentSelector(t *testing.T) {
	t.Parallel()
	f := buildDetailFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "merge-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	zero, one := 0, 1
	resp0 := requestOK(t, client, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.merge, ParentIndex: &zero})
	detail0 := unmarshalResult[porcelain.CommitDetail](t, resp0.Result)
	resp1 := requestOK(t, client, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.merge, ParentIndex: &one})
	detail1 := unmarshalResult[porcelain.CommitDetail](t, resp1.Result)

	if reflect.DeepEqual(filePaths(detail0.Files), filePaths(detail1.Files)) {
		t.Fatalf("file lists identical across parentIndex 0/1: %v", filePaths(detail0.Files))
	}

	outOfRange := 7
	badResp := client.request("commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.merge, ParentIndex: &outOfRange})
	if badResp.T != "res" || badResp.OK == nil || *badResp.OK {
		t.Fatalf("out-of-range parentIndex: got %+v, want a refused response", badResp)
	}
	if badResp.Error == nil || badResp.Error.Code != "E_BAD_REQUEST" {
		t.Fatalf("error = %+v, want E_BAD_REQUEST", badResp.Error)
	}
}

func TestIntegration_FileDiffShapes(t *testing.T) {
	t.Parallel()
	f := buildDetailFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "filediff-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	// text: a rename with an edit, proving probe P2's own consequence (both paths named).
	respText := requestOK(t, client, "commit.fileDiff", gitrpc.CommitFileDiffParams{RepoID: repoID, SHA: f.renamed, Path: "new.txt"})
	diffText := unmarshalResult[gitsession.FileDiffResult](t, respText.Result)
	if diffText.Body.Kind != porcelain.BodyText || len(diffText.Body.Hunks) == 0 {
		t.Fatalf("text diff body = %+v", diffText.Body)
	}
	if diffText.Change.OriginalPath == nil || *diffText.Change.OriginalPath != "old.txt" {
		t.Fatalf("change = %+v, want originalPath old.txt", diffText.Change)
	}

	// binary, with sizes filled from --batch-check.
	respBin := requestOK(t, client, "commit.fileDiff", gitrpc.CommitFileDiffParams{RepoID: repoID, SHA: f.binaryMod, Path: "bin.dat"})
	diffBin := unmarshalResult[gitsession.FileDiffResult](t, respBin.Result)
	if diffBin.Body.Kind != porcelain.BodyBinary {
		t.Fatalf("kind = %q, want binary", diffBin.Body.Kind)
	}
	if diffBin.Body.OldBytes == nil || diffBin.Body.NewBytes == nil {
		t.Fatalf("binary sizes = %+v, want both filled from --batch-check", diffBin.Body)
	}

	// empty, for a mode-only change.
	respMode := requestOK(t, client, "commit.fileDiff", gitrpc.CommitFileDiffParams{RepoID: repoID, SHA: f.modeChange, Path: "mode.txt"})
	diffMode := unmarshalResult[gitsession.FileDiffResult](t, respMode.Result)
	if diffMode.Body.Kind != porcelain.BodyEmpty || diffMode.Body.Reason != "modeChangeOnly" {
		t.Fatalf("mode-only diff body = %+v", diffMode.Body)
	}

	// tooLarge, for a patch over the domain cap.
	respHuge := requestOK(t, client, "commit.fileDiff", gitrpc.CommitFileDiffParams{RepoID: repoID, SHA: f.hugeMod, Path: "huge.txt"})
	diffHuge := unmarshalResult[gitsession.FileDiffResult](t, respHuge.Result)
	if diffHuge.Body.Kind != porcelain.BodyTooLarge {
		t.Fatalf("huge diff body = %+v, want tooLarge", diffHuge.Body)
	}
	if diffHuge.Body.Bytes <= gitsession.MaxPatchBytes || diffHuge.Body.LimitBytes != gitsession.MaxPatchBytes {
		t.Fatalf("tooLarge body = %+v, want bytes over %d and limitBytes == %d", diffHuge.Body, gitsession.MaxPatchBytes, gitsession.MaxPatchBytes)
	}
}

func TestIntegration_FileReadBranches(t *testing.T) {
	t.Parallel()
	f := buildDetailFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "read-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	respFound := requestOK(t, client, "file.read", gitrpc.FileReadParams{RepoID: repoID, Rev: f.root, Path: "a.txt"})
	found := unmarshalResult[gitsession.BlobResult](t, respFound.Result)
	if found.Kind != "found" || found.Content != "a\n" {
		t.Fatalf("found blob = %+v", found)
	}

	respMissing := requestOK(t, client, "file.read", gitrpc.FileReadParams{RepoID: repoID, Rev: f.root, Path: "does-not-exist.txt"})
	missing := unmarshalResult[gitsession.BlobResult](t, respMissing.Result)
	if missing.Kind != "missing" {
		t.Fatalf("missing blob = %+v", missing)
	}

	respBinary := requestOK(t, client, "file.read", gitrpc.FileReadParams{RepoID: repoID, Rev: f.binaryAdd, Path: "bin.dat"})
	binary := unmarshalResult[gitsession.BlobResult](t, respBinary.Result)
	if binary.Kind != "binary" {
		t.Fatalf("binary blob = %+v", binary)
	}

	// D10's own fallback: a path the batch protocol cannot express at all.
	respNewline := requestOK(t, client, "file.read", gitrpc.FileReadParams{RepoID: repoID, Rev: f.newlinePathCommit, Path: f.newlinePath})
	newline := unmarshalResult[gitsession.BlobResult](t, respNewline.Result)
	if newline.Kind != "found" || newline.Content != "newline path content\n" {
		t.Fatalf("newline-path blob = %+v", newline)
	}
}

func TestIntegration_GoToTargetBranches(t *testing.T) {
	t.Parallel()
	f := buildDetailFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "goto-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	// live, with drift: an uncommitted edit inserting two lines above a.txt's own single line.
	if err := os.WriteFile(filepath.Join(f.dir, "a.txt"), []byte("X\nY\na\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	respLive := requestOK(t, client, "file.goToTarget", gitrpc.FileGoToTargetParams{RepoID: repoID, Rev: f.root, Path: "a.txt"})
	live := unmarshalResult[gitsession.GoToTarget](t, respLive.Result)
	if live.Kind != "live" {
		t.Fatalf("live target = %+v", live)
	}
	if len(live.Hunks) == 0 {
		t.Fatal("want non-nil drift hunks after an uncommitted edit above the cursor")
	}
	if net := live.Hunks[0].NewLines - live.Hunks[0].OldLines; net != 2 {
		t.Fatalf("hunk = %+v, want a net +2 line insertion (the caller's own line shifts by exactly this)", live.Hunks[0])
	}

	// historical: deleted since, but its blob still exists at the rev that added it.
	respHist := requestOK(t, client, "file.goToTarget", gitrpc.FileGoToTargetParams{RepoID: repoID, Rev: f.goneAdd, Path: "gone.txt"})
	hist := unmarshalResult[gitsession.GoToTarget](t, respHist.Result)
	if hist.Kind != "historical" || hist.Rev != f.goneAdd || hist.Path != "gone.txt" {
		t.Fatalf("historical target = %+v", hist)
	}

	// unavailable: never on disk, never in this revision.
	respUn := requestOK(t, client, "file.goToTarget", gitrpc.FileGoToTargetParams{RepoID: repoID, Rev: f.root, Path: "never-existed.txt"})
	unavailable := unmarshalResult[gitsession.GoToTarget](t, respUn.Result)
	if unavailable.Kind != "unavailable" || unavailable.Reason != "notInRevision" {
		t.Fatalf("unavailable target = %+v", unavailable)
	}
}

// TestIntegration_DetailCacheDropsOnRefsChanged is D7's own end-to-end proof: a repeat
// commit.detail is a cache hit (no new 'show' spawn), and a refsChanged event (a real `git tag`)
// invalidates it — the next request spawns fresh and reports the new decoration.
func TestIntegration_DetailCacheDropsOnRefsChanged(t *testing.T) {
	t.Parallel()
	f := buildDetailFixtureRepo(t)
	realRunner := gitclient.NewExecRunner()
	var showSpawns int32
	countRunner := runnerFunc(func(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
		if len(spec.Args) > 0 && spec.Args[0] == "show" {
			atomic.AddInt32(&showSpawns, 1)
		}
		return realRunner.Start(ctx, gitPath, spec)
	})
	server, sockPath, _, _ := newIntegrationServerWithRunner(t, countRunner)
	client := pairAndReady(t, server, sockPath, "cache-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	resp1 := requestOK(t, client, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.root})
	_ = unmarshalResult[porcelain.CommitDetail](t, resp1.Result)
	afterFirst := atomic.LoadInt32(&showSpawns)
	if afterFirst == 0 {
		t.Fatal("expected at least one 'show' spawn for the first commit.detail")
	}

	resp2 := requestOK(t, client, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.root})
	_ = unmarshalResult[porcelain.CommitDetail](t, resp2.Result)
	if got := atomic.LoadInt32(&showSpawns); got != afterFirst {
		t.Fatalf("'show' spawns after a cached repeat = %d, want unchanged from %d", got, afterFirst)
	}

	runGitIn(t, f.dir, "tag", "v-cache-test", f.root)
	ev := client.recvEvent("repo.changed")
	if ev.Kind != "refsChanged" {
		t.Fatalf("event = %+v, want refsChanged", ev)
	}

	resp3 := requestOK(t, client, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.root})
	detail3 := unmarshalResult[porcelain.CommitDetail](t, resp3.Result)
	if got := atomic.LoadInt32(&showSpawns); got <= afterFirst {
		t.Fatalf("'show' spawns after refsChanged = %d, want an increase from %d (cache dropped)", got, afterFirst)
	}

	var sawTag bool
	for _, d := range detail3.Decoration {
		if d.Kind == porcelain.DecorationTag && d.Name == "v-cache-test" {
			sawTag = true
		}
	}
	if !sawTag {
		t.Fatalf("decoration after refsChanged = %+v, want the new tag", detail3.Decoration)
	}
}
