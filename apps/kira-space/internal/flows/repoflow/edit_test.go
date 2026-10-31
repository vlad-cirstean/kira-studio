package repoflow_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/codeworkspace"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

func sha(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func failure(t *testing.T, err error) map[string]any {
	t.Helper()
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("err = %v, want *ipcerr.Error", err)
	}
	out := map[string]any{"code": ie.Code, "message": ie.Message}
	if len(ie.Details) > 0 {
		var d any
		if err := json.Unmarshal(ie.Details, &d); err != nil {
			t.Fatal(err)
		}
		out["details"] = d
	}
	return out
}

func TestEditFile(t *testing.T) {
	app := flowharness.New(t)
	r := app.NewRepo("edit")
	r.Commit("init", map[string]string{"src/main.go": "package main\n", "README.md": "# hi\n"})
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
	disk := func(p string) []byte {
		b, err := os.ReadFile(filepath.Join(r.Dir, p))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	readEdit := func(p string) (codeworkspace.EditContent, error) {
		return cw.ReadFileForEdit(ctx, bridge.CodeWorkspaceReadFileArgs{ID: rec.ID, Path: p})
	}
	write := func(p, text, base string) (bridge.CodeWorkspaceWriteResult, error) {
		return cw.WriteFile(ctx, bridge.CodeWorkspaceWriteFileArgs{ID: rec.ID, Path: p, Text: text, BaseHash: base})
	}

	t.Run("read for edit and save", func(t *testing.T) {
		got, err := readEdit("src/main.go")
		if err != nil || got.Kind != "found" || got.Hash != sha(disk("src/main.go")) || got.Language != "go" {
			t.Fatalf("read = %+v, %v", got, err)
		}
		app.Contract(t, "repo-file-edit", "CodeWorkspaceService.ReadFileForEdit", got)
		if err := os.Chmod(filepath.Join(r.Dir, "src/main.go"), 0o755); err != nil {
			t.Fatal(err)
		}
		text := "package main\n\nfunc main() {}\n"
		res, err := write("src/main.go", text, got.Hash)
		if err != nil {
			t.Fatal(err)
		}
		if string(disk("src/main.go")) != text || res.Hash != sha([]byte(text)) {
			t.Fatalf("disk = %q, hash = %s", disk("src/main.go"), res.Hash)
		}
		if fi, _ := os.Stat(filepath.Join(r.Dir, "src/main.go")); fi.Mode().Perm() != 0o755 {
			t.Errorf("mode = %v, want 0755", fi.Mode().Perm())
		}
		app.Contract(t, "repo-file-edit", "CodeWorkspaceService.WriteFile", res)
	})

	t.Run("CRLF and BOM round-trip byte-exact", func(t *testing.T) {
		raw := []byte("\xef\xbb\xbfone\r\ntwo\r\n")
		mustWrite(t, filepath.Join(r.Dir, "win.txt"), raw)
		got, err := readEdit("win.txt")
		if err != nil || got.Kind != "found" {
			t.Fatalf("read = %+v, %v", got, err)
		}
		if _, err := write("win.txt", got.Text, got.Hash); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(disk("win.txt"), raw) {
			t.Fatalf("disk = %q, want %q", disk("win.txt"), raw)
		}
	})

	t.Run("conflict leaves disk untouched", func(t *testing.T) {
		mustWrite(t, filepath.Join(r.Dir, "c.txt"), []byte("v1\n"))
		got, _ := readEdit("c.txt")
		mustWrite(t, filepath.Join(r.Dir, "c.txt"), []byte("external\n"))
		_, err := write("c.txt", "mine\n", got.Hash)
		if errCode(err) != "E_CONFLICT" {
			t.Fatalf("err = %v, want E_CONFLICT", err)
		}
		if string(disk("c.txt")) != "external\n" {
			t.Fatalf("disk = %q", disk("c.txt"))
		}
		app.Contract(t, "repo-file-edit", "CodeWorkspaceService.WriteFile#conflict", failure(t, err))
	})

	t.Run("deleted then recreated", func(t *testing.T) {
		mustWrite(t, filepath.Join(r.Dir, "d.txt"), []byte("v1\n"))
		got, _ := readEdit("d.txt")
		if err := os.Remove(filepath.Join(r.Dir, "d.txt")); err != nil {
			t.Fatal(err)
		}
		if _, err := write("d.txt", "mine\n", got.Hash); errCode(err) != "E_CONFLICT" {
			t.Fatalf("err = %v, want E_CONFLICT", err)
		}
		if m, err := readEdit("d.txt"); err != nil || m.Kind != "missing" || m.Hash != "" {
			t.Fatalf("missing = %+v, %v", m, err)
		}
		if _, err := write("d.txt", "mine\n", ""); err != nil {
			t.Fatal(err)
		}
		if string(disk("d.txt")) != "mine\n" {
			t.Fatalf("disk = %q", disk("d.txt"))
		}
	})

	t.Run("refusals", func(t *testing.T) {
		for _, p := range []string{"escape", "../outside.txt", "src/../../outside.txt"} {
			if _, err := write(p, "x", sha([]byte("secret\n"))); errCode(err) != "E_CONTRACT" {
				t.Errorf("write %q = %v, want E_CONTRACT", p, err)
			}
			if _, err := readEdit(p); errCode(err) != "E_CONTRACT" {
				t.Errorf("read %q = %v, want E_CONTRACT", p, err)
			}
		}
		if string(disk("../outside.txt")) != "secret\n" {
			t.Error("outside file modified")
		}
		mustWrite(t, filepath.Join(r.Dir, "latin1.txt"), []byte("caf\xe9\n"))
		mustWrite(t, filepath.Join(r.Dir, "blob.bin"), []byte("a\x00b"))
		big := make([]byte, codeworkspace.MaxReadBytes+1)
		for i := range big {
			big[i] = 'a'
		}
		mustWrite(t, filepath.Join(r.Dir, "big.txt"), big)
		for p, kind := range map[string]string{"latin1.txt": "notUtf8", "blob.bin": "binary", "big.txt": "tooLarge"} {
			if got, err := readEdit(p); err != nil || got.Kind != kind || got.Text != "" {
				t.Errorf("read %s = %+v, %v, want kind %s", p, got, err, kind)
			}
		}
		if _, err := write("src/main.go", string(big), sha(disk("src/main.go"))); errCode(err) != "E_BAD_REQUEST" {
			t.Errorf("oversized save = %v, want E_BAD_REQUEST", err)
		}
		if _, err := write("src", "x", ""); errCode(err) != "E_BAD_REQUEST" {
			t.Errorf("directory save = %v, want E_BAD_REQUEST", err)
		}
	})

	t.Run("symlink inside root writes the target", func(t *testing.T) {
		got, err := readEdit("inside")
		if err != nil || got.Kind != "found" {
			t.Fatalf("read = %+v, %v", got, err)
		}
		if _, err := write("inside", "# changed\n", got.Hash); err != nil {
			t.Fatal(err)
		}
		if fi, err := os.Lstat(filepath.Join(r.Dir, "inside")); err != nil || fi.Mode()&os.ModeSymlink == 0 {
			t.Fatalf("link replaced: %v, %v", fi, err)
		}
		if string(disk("README.md")) != "# changed\n" {
			t.Fatalf("target = %q", disk("README.md"))
		}
	})

	t.Run("concurrent saves with one base: one wins", func(t *testing.T) {
		mustWrite(t, filepath.Join(r.Dir, "race.txt"), []byte("base\n"))
		got, _ := readEdit("race.txt")
		var wg sync.WaitGroup
		errs := make([]error, 8)
		for i := range errs {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, errs[i] = write("race.txt", "w"+string(rune('a'+i))+"\n", got.Hash)
			}()
		}
		wg.Wait()
		ok := 0
		for _, err := range errs {
			switch {
			case err == nil:
				ok++
			case errCode(err) != "E_CONFLICT":
				t.Errorf("err = %v, want E_CONFLICT", err)
			}
		}
		if ok != 1 {
			t.Fatalf("%d saves won, want 1", ok)
		}
	})
}
