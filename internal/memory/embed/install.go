package embed

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/gomlx/go-huggingface/hub"
)

// ErrChecksum means a downloaded file does not match its pinned SHA-256.
var ErrChecksum = errors.New("embed: downloaded file failed its checksum")

// Install downloads every file of s into dir and writes the manifest last, so a partial install
// is never mistaken for a complete one. progress reports bytes across all files. A checksum
// mismatch deletes the file and returns ErrChecksum.
func Install(ctx context.Context, dir string, s Spec, progress func(done, total int64)) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("embed: create model dir: %w", err)
	}
	_ = os.Remove(filepath.Join(dir, manifestName))
	mgr := hub.New("").GetDownloadManager()
	total := s.TotalSize()
	var (
		mu       sync.Mutex
		finished int64
	)
	report := func(inFile int64) {
		if progress != nil {
			mu.Lock()
			done := finished + inFile
			mu.Unlock()
			progress(min(done, total), total)
		}
	}
	for _, f := range s.Files {
		dst := filepath.Join(dir, f.Name)
		tmp := dst + ".part"
		_ = os.Remove(tmp)
		if err := mgr.Download(ctx, f.URL, tmp, func(done, _ int64) { report(done) }); err != nil {
			_ = os.Remove(tmp)
			return fmt.Errorf("embed: download %s: %w", f.Name, err)
		}
		if err := verifyAndSync(tmp, f); err != nil {
			_ = os.Remove(tmp)
			return err
		}
		if err := os.Rename(tmp, dst); err != nil {
			return fmt.Errorf("embed: install %s: %w", f.Name, err)
		}
		mu.Lock()
		finished += f.Size
		mu.Unlock()
		report(0)
	}
	return writeManifest(dir, s)
}

func verifyAndSync(path string, f File) error {
	fh, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return fmt.Errorf("embed: open %s: %w", f.Name, err)
	}
	defer fh.Close()
	h := sha256.New()
	n, err := io.Copy(h, fh)
	if err != nil {
		return fmt.Errorf("embed: hash %s: %w", f.Name, err)
	}
	if n != f.Size || hex.EncodeToString(h.Sum(nil)) != f.SHA256 {
		return fmt.Errorf("%w: %s", ErrChecksum, f.Name)
	}
	if err := fh.Sync(); err != nil {
		return fmt.Errorf("embed: sync %s: %w", f.Name, err)
	}
	return nil
}
