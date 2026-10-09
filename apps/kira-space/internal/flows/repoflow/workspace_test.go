package repoflow_test

import (
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/codeworkspace"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func TestBrowseReadDiff(t *testing.T) {
	app := flowharness.New(t)
	r := app.NewRepo("browse")
	r.Commit("init", map[string]string{
		".gitignore":       "build/\n*.log\n",
		"src/main.go":      "package main\n",
		"src/deep/a/b.txt": "deep\n",
		"README.md":        "# hi\n",
	})
	r.WriteBinary("blob.bin", 4096)
	r.Git("add", "blob.bin")
	r.Commit("binary", nil)
	// Local state: modified, untracked, ignored, oversized.
	r.Write("src/main.go", "package main\n\nfunc main() {}\n")
	r.Write("new.txt", "untracked\n")
	r.Write("build/out.o", "x")
	r.Write("debug.log", "x")
	big := make([]byte, codeworkspace.MaxReadBytes+1)
	for i := range big {
		big[i] = 'a'
	}
	mustWrite(t, filepath.Join(r.Dir, "big.txt"), big)

	outside := filepath.Join(app.Work, "outside.txt")
	mustWrite(t, outside, []byte("secret\n"))
	if err := os.Symlink(outside, filepath.Join(r.Dir, "escape")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("README.md", filepath.Join(r.Dir, "inside")); err != nil {
		t.Fatal(err)
	}

	rec := importVia(t, app, r.Dir)
	cw := app.W.CodeWorkspace
	if err := cw.OpenWorkspace(ctx, idArgs(rec.ID)); err != nil {
		t.Fatal(err)
	}

	t.Run("list matches git", func(t *testing.T) {
		got, err := cw.ListFiles(ctx, idArgs(rec.ID))
		if err != nil {
			t.Fatal(err)
		}
		want := strings.Split(r.Git("ls-files", "--cached", "--others", "--exclude-standard"), "\n")
		sort.Strings(want)
		have := slices.Clone(got.Paths)
		sort.Strings(have)
		if !slices.Equal(have, want) {
			t.Fatalf("paths = %v, want %v", have, want)
		}
		for _, ignored := range []string{"build/out.o", "debug.log"} {
			if slices.Contains(got.Paths, ignored) {
				t.Errorf("ignored %s listed", ignored)
			}
		}
		if !slices.Contains(got.Paths, "src/deep/a/b.txt") {
			t.Error("nested file missing")
		}
		if got.Status["src/main.go"] == "" || got.Status["new.txt"] == "" || got.Status["README.md"] != "" {
			t.Errorf("status overlay = %v, want main.go and new.txt marked, README clean", got.Status)
		}
		if got.Truncated {
			t.Error("small repo reported truncated")
		}
	})

	read := func(path string) (codeworkspace.FileContent, error) {
		return cw.ReadFile(ctx, bridge.CodeWorkspaceReadFileArgs{ID: rec.ID, Path: path})
	}

	t.Run("read classifies text, binary, oversized, missing", func(t *testing.T) {
		txt, err := read("src/main.go")
		if err != nil || txt.Kind != "found" || txt.Text != "package main\n\nfunc main() {}\n" || txt.Language == "" {
			t.Fatalf("text = %+v, %v", txt, err)
		}
		if b, err := read("blob.bin"); err != nil || b.Kind != "binary" {
			t.Fatalf("binary = %+v, %v", b, err)
		}
		if b, err := read("big.txt"); err != nil || b.Kind != "tooLarge" || b.LimitBytes != codeworkspace.MaxReadBytes {
			t.Fatalf("large = %+v, %v", b, err)
		}
		if m, err := read("gone.txt"); err != nil || m.Kind != "missing" {
			t.Fatalf("missing = %+v, %v", m, err)
		}
		if in, err := read("inside"); err != nil || in.Kind != "found" || in.Text != "# hi\n" {
			t.Fatalf("in-root symlink = %+v, %v", in, err)
		}
	})

	t.Run("escapes refused", func(t *testing.T) {
		for _, p := range []string{"escape", "../outside.txt", "src/../../outside.txt", outside} {
			if c, err := read(p); errCode(err) != "E_INVALID" {
				t.Errorf("read %q = %+v, %v, want E_INVALID", p, c, err)
			}
			_, err := cw.ReadDiff(ctx, bridge.CodeWorkspaceReadFileArgs{ID: rec.ID, Path: p})
			if err == nil {
				t.Errorf("ReadDiff %q succeeded", p)
			}
		}
	})

	t.Run("diff against HEAD", func(t *testing.T) {
		d, err := cw.ReadDiff(ctx, bridge.CodeWorkspaceReadFileArgs{ID: rec.ID, Path: "src/main.go"})
		if err != nil {
			t.Fatal(err)
		}
		head := r.Git("show", "HEAD:src/main.go") + "\n"
		if d.Head.Kind != "found" || d.Head.Text != head || d.Worktree.Text != "package main\n\nfunc main() {}\n" {
			t.Fatalf("diff = %+v", d)
		}
		added, err := cw.ReadDiff(ctx, bridge.CodeWorkspaceReadFileArgs{ID: rec.ID, Path: "new.txt"})
		if err != nil || added.Head.Kind != "missing" || added.Worktree.Kind != "found" {
			t.Fatalf("added diff = %+v, %v", added, err)
		}
		if err := os.Remove(filepath.Join(r.Dir, "README.md")); err != nil {
			t.Fatal(err)
		}
		deleted, err := cw.ReadDiff(ctx, bridge.CodeWorkspaceReadFileArgs{ID: rec.ID, Path: "README.md"})
		if err != nil || deleted.Head.Kind != "found" || deleted.Worktree.Kind != "missing" {
			t.Fatalf("deleted diff = %+v, %v", deleted, err)
		}
	})

	t.Run("unknown and empty ids", func(t *testing.T) {
		if _, err := cw.ListFiles(ctx, idArgs("nope")); errCode(err) != "E_NOT_FOUND" {
			t.Fatalf("unknown id err = %v", err)
		}
		if _, err := cw.ListFiles(ctx, idArgs("")); errCode(err) != "E_BAD_REQUEST" {
			t.Fatalf("empty id err = %v", err)
		}
	})
}

func searchEvents(app *flowharness.App, window string) (files map[string][]int, done bool, stats *codeworkspace.SearchStats, searchErr *bridge.CodeSearchEventErr, total int) {
	files = map[string][]int{}
	for _, ev := range app.Events.Since(0, bridge.ChannelCodeSearch) {
		if ev.Window != window {
			continue
		}
		p := ev.Data.(bridge.CodeSearchEvent)
		for _, f := range p.Files {
			for _, m := range f.Matches {
				files[f.Path] = append(files[f.Path], m.Line)
				total++
			}
		}
		if p.Done {
			done, stats, searchErr = true, p.Stats, p.Error
		}
	}
	return
}

func TestCodeSearch(t *testing.T) {
	app := flowharness.New(t)
	r := app.NewRepo("search")
	files := map[string]string{}
	for i := range 40 {
		var b strings.Builder
		for l := range 30 {
			b.WriteString("line " + strconv.Itoa(l) + " filler\n")
			if (i+l)%11 == 0 {
				b.WriteString("the needle is here\n")
			}
		}
		files["pkg"+strconv.Itoa(i%4)+"/f"+strconv.Itoa(i)+".txt"] = b.String()
	}
	r.Commit("corpus", files)
	rec := importVia(t, app, r.Dir)
	cw := app.W.CodeWorkspace

	t.Run("hits equal git grep", func(t *testing.T) {
		h, err := cw.StartSearch(ctx, bridge.CodeWorkspaceSearchArgs{ID: rec.ID, WindowKey: "w1", Query: "needle", CaseSensitive: true})
		if err != nil || h.SearchID == "" {
			t.Fatalf("StartSearch = %+v, %v", h, err)
		}
		waitFor(t, 10*time.Second, func() bool { _, done, _, _, _ := searchEvents(app, "w1"); return done })
		got, _, stats, searchErr, total := searchEvents(app, "w1")
		if searchErr != nil {
			t.Fatalf("search error %+v", searchErr)
		}
		want := map[string][]int{}
		wantTotal := 0
		for _, line := range strings.Split(r.Git("grep", "-n", "needle"), "\n") {
			parts := strings.SplitN(line, ":", 3)
			n, _ := strconv.Atoi(parts[1])
			want[parts[0]] = append(want[parts[0]], n)
			wantTotal++
		}
		if total != wantTotal || len(got) != len(want) {
			t.Fatalf("hits = %d in %d files, git grep %d in %d", total, len(got), wantTotal, len(want))
		}
		for p, lines := range want {
			g := slices.Clone(got[p])
			sort.Ints(g)
			if !slices.Equal(g, lines) {
				t.Errorf("%s lines = %v, want %v", p, g, lines)
			}
		}
		if stats == nil || stats.Matches != wantTotal || stats.FilesMatched != len(want) {
			t.Errorf("stats = %+v, want %d matches in %d files", stats, wantTotal, len(want))
		}
	})

	t.Run("bad regex refused up front", func(t *testing.T) {
		_, err := cw.StartSearch(ctx, bridge.CodeWorkspaceSearchArgs{ID: rec.ID, WindowKey: "w2", Query: "(", Regex: true})
		if errCode(err) != "E_INVALID" {
			t.Fatalf("err = %v, want E_INVALID", err)
		}
	})

	t.Run("cancel stops events", func(t *testing.T) {
		big := app.NewRepo("search-big")
		bulk := map[string]string{}
		line := strings.Repeat("x", 80) + " needle\n"
		for i := range 600 {
			bulk["d"+strconv.Itoa(i%20)+"/f"+strconv.Itoa(i)+".txt"] = strings.Repeat(line, 400)
		}
		big.Commit("bulk", bulk)
		brec := importVia(t, app, big.Dir)
		if _, err := cw.StartSearch(ctx, bridge.CodeWorkspaceSearchArgs{ID: brec.ID, WindowKey: "w3", Query: "needle"}); err != nil {
			t.Fatal(err)
		}
		if err := cw.CancelSearch(idArgs(brec.ID)); err != nil {
			t.Fatal(err)
		}
		waitFor(t, 10*time.Second, func() bool { _, done, _, _, _ := searchEvents(app, "w3"); return done })
		_, _, stats, searchErr, total := searchEvents(app, "w3")
		if searchErr != nil {
			t.Fatalf("cancel surfaced as error %+v", searchErr)
		}
		time.Sleep(300 * time.Millisecond)
		_, _, _, _, after := searchEvents(app, "w3")
		if after != total {
			t.Fatalf("events kept coming after done: %d -> %d", total, after)
		}
		if stats == nil || stats.Truncated || stats.Matches >= codeworkspace.MaxSearchMatches {
			t.Errorf("stats = %+v, want a partial run (an uncancelled search hits the %d cap)", stats, codeworkspace.MaxSearchMatches)
		}
	})
}

// Leaving a workspace while its search runs ends the search quietly (no error, no more events) and
// the workspace reopens on the next read.
func TestCloseWorkspaceStopsSearch(t *testing.T) {
	app := flowharness.New(t)
	big := app.NewRepo("search-close")
	bulk := map[string]string{}
	line := strings.Repeat("x", 80) + " needle\n"
	for i := range 600 {
		bulk["d"+strconv.Itoa(i%20)+"/f"+strconv.Itoa(i)+".txt"] = strings.Repeat(line, 400)
	}
	big.Commit("bulk", bulk)
	rec := importVia(t, app, big.Dir)
	cw := app.W.CodeWorkspace

	if _, err := cw.StartSearch(ctx, bridge.CodeWorkspaceSearchArgs{ID: rec.ID, WindowKey: "w1", Query: "needle"}); err != nil {
		t.Fatal(err)
	}
	if err := cw.CloseWorkspace(idArgs(rec.ID)); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 10*time.Second, func() bool { _, done, _, _, _ := searchEvents(app, "w1"); return done })
	_, _, stats, searchErr, total := searchEvents(app, "w1")
	if searchErr != nil {
		t.Fatalf("closing the workspace surfaced as a search error: %+v", searchErr)
	}
	if stats != nil && stats.Matches >= codeworkspace.MaxSearchMatches {
		t.Fatalf("search ran to its cap (%+v) after the workspace closed", stats)
	}
	time.Sleep(300 * time.Millisecond)
	if _, _, _, _, after := searchEvents(app, "w1"); after != total {
		t.Fatalf("events kept coming after close: %d -> %d", total, after)
	}

	// Closing twice, or an id that never opened, is harmless; an empty id is refused.
	if err := cw.CloseWorkspace(idArgs(rec.ID)); err != nil {
		t.Fatalf("second CloseWorkspace = %v", err)
	}
	if err := cw.CloseWorkspace(idArgs("")); errCode(err) != "E_BAD_REQUEST" {
		t.Fatalf("CloseWorkspace with no id = %v, want E_BAD_REQUEST", err)
	}
	if _, err := cw.ReadFile(ctx, bridge.CodeWorkspaceReadFileArgs{ID: rec.ID, Path: "d0/f0.txt"}); err != nil {
		t.Fatalf("ReadFile after close: %v", err)
	}
}
