package codeindex

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// benchFixtureFileCount is P64c §4.1's own fixture size — a few hundred small Go/TypeScript files,
// enough to cross replaceFileBatch's 256-file batch boundary at least once.
const benchFixtureFileCount = 300

// requireRealGitTB and runGitTB mirror sync_test.go's requireRealGit/runGit against testing.TB
// (both *testing.T and *testing.B satisfy it) so the benchmark can share the same real-git,
// real-tempdir fixture shape without needing a *testing.T.
func requireRealGitTB(tb testing.TB) string {
	tb.Helper()
	path, err := exec.LookPath("git")
	if err != nil {
		tb.Skip("no git on PATH in this environment")
	}
	return path
}

func runGitTB(tb testing.TB, dir string, args ...string) {
	tb.Helper()
	gitPath := requireRealGitTB(tb)
	cmd := exec.Command(gitPath, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		tb.Fatalf("git %v: %v\n%s", args, err, out.String())
	}
}

// genBenchFixtureRepo writes benchFixtureFileCount small Go/TypeScript files into a fresh
// git-init'ed temp repository and returns its root. Generated, not this repository's own tree
// (§4.1): a benchmark depending on the developer's checkout would drift with every commit.
func genBenchFixtureRepo(tb testing.TB) string {
	tb.Helper()
	dir := tb.TempDir()
	runGitTB(tb, dir, "init", "-q", "-b", "main")

	for i := 0; i < benchFixtureFileCount; i++ {
		var name, content string
		if i%3 == 0 {
			name = fmt.Sprintf("pkg%d/file%d.ts", i/40, i)
			content = fmt.Sprintf(`export interface Shape%d {
	id: number;
	name: string;
}

export function make%d(id: number, name: string): Shape%d {
	return { id, name };
}

export class Holder%d {
	private items: Shape%d[] = [];

	add(s: Shape%d): void {
		this.items.push(s);
	}

	find(id: number): Shape%d | undefined {
		return this.items.find((s) => s.id === id);
	}
}
`, i, i, i, i, i, i, i)
		} else {
			name = fmt.Sprintf("pkg%d/file%d.go", i/40, i)
			content = fmt.Sprintf(`package pkg%d

import "fmt"

// Shape%d is a benchmark fixture type.
type Shape%d struct {
	ID   int
	Name string
}

// NewShape%d builds a Shape%d.
func NewShape%d(id int, name string) Shape%d {
	return Shape%d{ID: id, Name: name}
}

func (s Shape%d) String() string {
	return fmt.Sprintf("%%d:%%s", s.ID, s.Name)
}
`, i/40, i, i, i, i, i, i, i, i)
		}

		full := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			tb.Fatalf("mkdir for %s: %v", name, err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			tb.Fatalf("write %s: %v", name, err)
		}
	}
	return dir
}

// BenchmarkFullSync measures one cold full Sync — enumerate, parse every file, write every row —
// over a generated fixture repository. Reports the standing answer to "did this get slower"
// (P64c §4.1); it is not a correctness test.
func BenchmarkFullSync(b *testing.B) {
	gitPath := requireRealGitTB(b)
	dir := genBenchFixtureRepo(b)
	runner := gitclient.NewExecRunner()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		home := b.TempDir()
		store := OpenStoreAt(home)
		idx := Open(store, runner, gitPath, fmt.Sprintf("bench-repo-%d", i), dir)
		b.StartTimer()

		if _, err := idx.Sync(context.Background()); err != nil {
			b.Fatalf("Sync: %v", err)
		}

		b.StopTimer()
		idx.Close()
		_ = store.Close()
		b.StartTimer()
	}
}
