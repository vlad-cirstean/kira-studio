package porcelain_test

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// TestRevSetArgs_AllScopeExcludesKiraNamespace is G28 D15/probe P11's own golden: the `--all`
// scope (the default/unset case too) always excludes `refs/kira/*`, and `--exclude` precedes the
// `--all` it modifies.
func TestRevSetArgs_AllScopeExcludesKiraNamespace(t *testing.T) {
	got := porcelain.RevSetArgs(porcelain.WalkSpec{Scope: "all"})
	want := []string{"--exclude=refs/kira/*", "--all"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("RevSetArgs(all) = %v, want %v", got, want)
	}
}

func TestRevSetArgs_UnsetScopeBehavesLikeAll(t *testing.T) {
	got := porcelain.RevSetArgs(porcelain.WalkSpec{})
	want := []string{"--exclude=refs/kira/*", "--all"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("RevSetArgs(unset) = %v, want %v", got, want)
	}
}

// TestRevSetArgs_ExcludeStashAddsExcludeStashBeforeAll proves the three-token order exactly:
// refs/kira/* exclusion first, refs/stash exclusion second, --all last.
func TestRevSetArgs_ExcludeStashAddsExcludeStashBeforeAll(t *testing.T) {
	got := porcelain.RevSetArgs(porcelain.WalkSpec{Scope: "all", ExcludeStash: true})
	want := []string{"--exclude=refs/kira/*", "--exclude=refs/stash", "--all"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("RevSetArgs(all, ExcludeStash) = %v, want %v", got, want)
	}
}

// TestRevSetArgs_HeadScopeNeverExcludes proves the `head` scope emits neither exclusion — it never
// walks `--all` at all, so an exclusion would be meaningless.
func TestRevSetArgs_HeadScopeNeverExcludes(t *testing.T) {
	got := porcelain.RevSetArgs(porcelain.WalkSpec{Scope: "head", ExcludeStash: true})
	want := []string{"HEAD"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("RevSetArgs(head) = %v, want %v", got, want)
	}
}

// TestRevSetArgs_RangeNeverExcludes proves a ranged walk emits neither exclusion either, same
// reasoning as the head scope.
func TestRevSetArgs_RangeNeverExcludes(t *testing.T) {
	got := porcelain.RevSetArgs(porcelain.WalkSpec{Range: &porcelain.RangeSpec{Base: "main", Branch: "topic"}, ExcludeStash: true})
	want := []string{"main..topic"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("RevSetArgs(range) = %v, want %v", got, want)
	}
}

// TestRevSetArgs_IncludeStashShasAppendAfterExcludes proves G8's own stash-sha injection still
// lands after the exclude/--all tokens, unaffected by G28's own additions.
func TestRevSetArgs_IncludeStashShasAppendAfterExcludes(t *testing.T) {
	got := porcelain.RevSetArgs(porcelain.WalkSpec{Scope: "all", IncludeStash: true, StashShas: []string{"deadbeef"}})
	want := []string{"--exclude=refs/kira/*", "--all", "deadbeef"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("RevSetArgs(all, IncludeStash) = %v, want %v", got, want)
	}
}

// parseFixture reads and fully parses a committed .bin fixture into every CommitRecord it holds,
// in the order git emitted them.
func parseFixture(t *testing.T, relPath string) []porcelain.CommitRecord {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", relPath))
	if err != nil {
		t.Fatalf("read fixture %s: %v (run KIRA_GIT_FIXTURES=write to regenerate the golden corpus)", relPath, err)
	}
	splitter := porcelain.NewRecordSplitter(0)
	recs, err := splitter.Push(b)
	if err != nil {
		t.Fatalf("split %s: %v", relPath, err)
	}
	if flushed := splitter.Flush(); flushed != nil {
		t.Fatalf("%s: unterminated trailing bytes: %q", relPath, flushed)
	}
	out := make([]porcelain.CommitRecord, len(recs))
	for i, rec := range recs {
		cr, err := porcelain.ParseLogRecord(rec)
		if err != nil {
			t.Fatalf("parse record %d of %s: %v", i, relPath, err)
		}
		out[i] = cr
	}
	return out
}

// TestLog_GeneratedTopologies is the golden corpus's structural half (D15): parent counts and
// decoration classification per deterministic topology, sha-pinned since these fixtures'
// deterministic identity/dates/content make their shas reproducible across regenerations.
func TestLog_GeneratedTopologies(t *testing.T) {
	t.Run("linear", func(t *testing.T) {
		recs := parseFixture(t, "log/linear.bin")
		if len(recs) != 3 {
			t.Fatalf("got %d records, want 3", len(recs))
		}
		for _, r := range recs {
			if len(r.Parents) > 1 {
				t.Fatalf("linear history has a merge: %+v", r)
			}
		}
		head := recs[0]
		if head.SHA != "2df820c2aa5af864e4c4a77aa8d5ea8e31331c79" {
			t.Fatalf("HEAD sha = %s, want the pinned value", head.SHA)
		}
		if len(head.Decoration) != 1 || head.Decoration[0] != (porcelain.DecorationRef{Kind: porcelain.DecorationBranch, Name: "main", IsHead: true}) {
			t.Fatalf("HEAD decoration = %+v, want HEAD -> main", head.Decoration)
		}
		root := recs[len(recs)-1]
		if len(root.Parents) != 0 {
			t.Fatalf("root commit has parents: %+v", root.Parents)
		}
	})

	t.Run("branchy", func(t *testing.T) {
		recs := parseFixture(t, "log/branchy.bin")
		if len(recs) != 4 {
			t.Fatalf("got %d records, want 4", len(recs))
		}
		merge := recs[0]
		if len(merge.Parents) != 2 {
			t.Fatalf("merge commit has %d parents, want 2: %+v", len(merge.Parents), merge)
		}
		if len(merge.Decoration) != 1 || merge.Decoration[0].Kind != porcelain.DecorationBranch || !merge.Decoration[0].IsHead {
			t.Fatalf("merge decoration = %+v, want HEAD -> main", merge.Decoration)
		}
		var sawFeatureBranch, sawTag bool
		for _, r := range recs {
			for _, d := range r.Decoration {
				if d.Kind == porcelain.DecorationBranch && d.Name == "feature" {
					sawFeatureBranch = true
				}
				if d.Kind == porcelain.DecorationTag && d.Name == "v1.0" {
					sawTag = true
				}
			}
		}
		if !sawFeatureBranch {
			t.Fatal("no commit decorated with the surviving 'feature' branch")
		}
		if !sawTag {
			t.Fatal("no commit decorated with tag 'v1.0'")
		}
	})

	t.Run("crissCross", func(t *testing.T) {
		recs := parseFixture(t, "log/crissCross.bin")
		var merges int
		for _, r := range recs {
			if len(r.Parents) == 2 {
				merges++
			}
			if len(r.Parents) > 2 {
				t.Fatalf("unexpected >2-parent commit in a criss-cross fixture: %+v", r)
			}
		}
		if merges != 2 {
			t.Fatalf("got %d 2-parent merge commits, want 2", merges)
		}
	})

	t.Run("octopus", func(t *testing.T) {
		recs := parseFixture(t, "log/octopus.bin")
		if len(recs) != 4 {
			t.Fatalf("got %d records, want 4", len(recs))
		}
		octopus := recs[0]
		if len(octopus.Parents) != 3 {
			t.Fatalf("octopus merge has %d parents, want 3: %+v", len(octopus.Parents), octopus)
		}
	})
}

// TestLog_HandAuthoredEdgeCases covers what no generated topology produces on its own (D15).
func TestLog_HandAuthoredEdgeCases(t *testing.T) {
	t.Run("emptySubject", func(t *testing.T) {
		recs := parseFixture(t, "handAuthored/emptySubject.bin")
		if len(recs) != 1 || recs[0].Subject != "" {
			t.Fatalf("got %+v, want a single record with an empty subject", recs)
		}
	})

	t.Run("crlfSubject", func(t *testing.T) {
		recs := parseFixture(t, "handAuthored/crlfSubject.bin")
		if len(recs) != 1 {
			t.Fatalf("got %d records, want 1", len(recs))
		}
		want := "Sub\rject line"
		if recs[0].Subject != want {
			t.Fatalf("subject = %q, want %q (a CR embedded mid-subject, byte for byte)", recs[0].Subject, want)
		}
	})

	t.Run("subjectWith0x1f", func(t *testing.T) {
		recs := parseFixture(t, "handAuthored/subjectWith0x1f.bin")
		if len(recs) != 1 {
			t.Fatalf("got %d records, want 1", len(recs))
		}
		want := "Weird\x1fSubject"
		if recs[0].Subject != want {
			t.Fatalf("subject = %q, want %q (a literal 0x1f inside the final field must not shift any earlier field)", recs[0].Subject, want)
		}
		if recs[0].SHA == "" || len(recs[0].Parents) != 0 {
			t.Fatalf("earlier fields corrupted by the embedded delimiter: %+v", recs[0])
		}
	})

	t.Run("fullDecoration", func(t *testing.T) {
		recs := parseFixture(t, "handAuthored/fullDecoration.bin")
		if len(recs) != 1 {
			t.Fatalf("got %d records, want 1", len(recs))
		}
		got := recs[0].Decoration
		want := []porcelain.DecorationRef{
			{Kind: porcelain.DecorationBranch, Name: "main", IsHead: true},
			{Kind: porcelain.DecorationTag, Name: "v2.0"},
			{Kind: porcelain.DecorationStash},
			{Kind: porcelain.DecorationRemoteBranch, Name: "origin/main"},
			{Kind: porcelain.DecorationBranch, Name: "other-branch"},
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("decoration = %+v, want %+v", got, want)
		}
	})
}
