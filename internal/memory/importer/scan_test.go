package importer

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func write(t *testing.T, root, rel string, data []byte) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestScanWalkRules(t *testing.T) {
	root := t.TempDir()
	body := []byte("# Title\n\nSome text.\n")
	for _, rel := range []string{
		"keep.md", "notes.txt", "sub/deep.mdx", "sub/keep-me.md",
		".hidden/secret.md", ".dotfile.md", "node_modules/pkg/readme.md",
		"ignored.md", "sub/ignored-nested.md", "docs/gen/out.md", "docs/gen/keep.md",
	} {
		write(t, root, rel, body)
	}
	write(t, root, ".gitignore", []byte("ignored.md\n"))
	write(t, root, "sub/.gitignore", []byte("ignored-nested.md\n*.mdx\n!deep.mdx\n"))
	write(t, root, "docs/.gitignore", []byte("gen/*\n!gen/keep.md\n"))
	write(t, root, "image.png", []byte("png"))
	write(t, root, "bin.md", append([]byte("abc"), 0, 1, 2))
	write(t, root, "latin1.md", []byte{'c', 'a', 'f', 0xe9, '\n'})
	write(t, root, "empty.md", nil)
	write(t, root, "blank.md", []byte("  \n\n"))
	write(t, root, "big.md", bytes.Repeat([]byte("x"), 300<<10))
	write(t, root, "bom.md", append([]byte("\xef\xbb\xbf"), "a\r\nb\r\n"...))
	if err := os.Symlink(filepath.Join(root, "keep.md"), filepath.Join(root, "link.md")); err != nil {
		t.Fatal(err)
	}
	other := t.TempDir()
	write(t, other, "outside.md", body)
	if err := os.Symlink(other, filepath.Join(root, "linkdir")); err != nil {
		t.Fatal(err)
	}

	res, err := Scan(context.Background(), []string{root}, DefaultCaps)
	if err != nil {
		t.Fatal(err)
	}
	var files []string
	for _, f := range res.Files {
		files = append(files, f.Rel)
	}
	wantFiles := []string{"bom.md", "docs/gen/keep.md", "keep.md", "notes.txt", "sub/deep.mdx", "sub/keep-me.md"}
	if !slices.Equal(files, wantFiles) {
		t.Errorf("files = %v, want %v", files, wantFiles)
	}
	reasons := map[string]string{}
	for _, s := range res.Skipped {
		reasons[s.Rel] = s.Reason
	}
	for rel, want := range map[string]string{
		"bin.md": "binary", "latin1.md": "not UTF-8 text", "empty.md": "empty", "blank.md": "empty",
		"big.md": "too large (limit 256 KB)", "link.md": "symlink",
	} {
		if reasons[rel] != want {
			t.Errorf("%s reason = %q, want %q", rel, reasons[rel], want)
		}
	}
	if len(res.Skipped) != 6 {
		t.Errorf("skipped = %v", reasons)
	}
	if res.Truncated || res.Base != root && !strings.HasSuffix(res.Base, filepath.Base(root)) {
		t.Errorf("truncated=%v base=%q", res.Truncated, res.Base)
	}
	// image.png, .hidden/ and node_modules/ (one each), .dotfile.md, ignored.md,
	// sub/ignored-nested.md, docs/gen/out.md, and the symlinked dir.
	if res.Ignored < 7 {
		t.Errorf("ignored = %d", res.Ignored)
	}
	for _, f := range res.Files {
		if f.Rel == "bom.md" && f.Hash == "" {
			t.Error("missing hash")
		}
	}

	capped, err := Scan(context.Background(), []string{root}, Caps{MaxFileBytes: 256 << 10, MaxFiles: 3})
	if err != nil || !capped.Truncated || len(capped.Files) != 3 {
		t.Errorf("cap: err=%v truncated=%v files=%d", err, capped.Truncated, len(capped.Files))
	}
}

func TestScanPickedFilesBase(t *testing.T) {
	root := t.TempDir()
	write(t, root, "a/one.md", []byte("one\n"))
	write(t, root, "b/two.md", []byte("two\n"))
	res, err := Scan(context.Background(), []string{filepath.Join(root, "a/one.md"), filepath.Join(root, "b/two.md")}, DefaultCaps)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Files) != 2 || res.Files[0].Rel != "a/one.md" || res.Files[1].Rel != "b/two.md" {
		t.Errorf("files = %+v", res.Files)
	}
}
