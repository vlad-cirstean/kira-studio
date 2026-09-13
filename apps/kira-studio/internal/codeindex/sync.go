package codeindex

import (
	"bytes"
	"context"
	"crypto/sha256"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
)

// maxFileBytes is §5.4's per-file byte bound: a larger file is recorded tooLarge with no symbols.
const maxFileBytes = 2 * 1024 * 1024

// binaryProbeBytes is §5.4's binary rule: a NUL byte in a file's first 8 KiB marks it binary.
const binaryProbeBytes = 8 * 1024

// syncWorkers is §8's own bound — cap how much of the machine a background reindex takes, not
// maximise throughput (the same reason gitclient.maxConcurrentReads picks 4).
func syncWorkers() int {
	if n := runtime.NumCPU(); n < 4 {
		if n < 1 {
			return 1
		}
		return n
	}
	return 4
}

// SyncStats reports one Sync pass's own work — recorded in a commit message or a log line, per
// §13's own posture (a number stated, not a threshold asserted).
type SyncStats struct {
	FilesParsed  int
	FilesSkipped int // tooLarge, binary or unreadable
	FilesDeleted int
	ByLanguage   map[codeparse.ID]int
}

// Sync is one reconcile pass (§6): enumerate, apply §5.3's staleness rules and parse the stale
// ones, delete rows for paths that left enumeration, and record meta.last_full_sync_at.
func (idx *Index) Sync(ctx context.Context) (SyncStats, error) {
	stats := SyncStats{ByLanguage: map[codeparse.ID]int{}}

	if err := idx.checkFingerprint(ctx); err != nil {
		return stats, err
	}

	enumerated, err := Enumerate(ctx, idx.runner, idx.gitPath, idx.root)
	if err != nil {
		return stats, err
	}
	enumeratedSet := make(map[string]bool, len(enumerated))
	for _, e := range enumerated {
		enumeratedSet[e.Path] = true
	}

	existingRows, err := idx.store.ListFiles(ctx, idx.repoID)
	if err != nil {
		return stats, err
	}
	existingByPath := make(map[string]FileRow, len(existingRows))
	for _, r := range existingRows {
		existingByPath[r.Path] = r
	}

	writes, err := idx.parseStale(ctx, enumerated, existingByPath)
	if err != nil {
		return stats, err
	}
	if err := idx.store.ReplaceFiles(ctx, writes); err != nil {
		return stats, err
	}
	for _, w := range writes {
		if w.ParseStatus != StatusOK {
			stats.FilesSkipped++
		} else {
			stats.FilesParsed++
		}
		stats.ByLanguage[codeparse.ID(w.Language)]++
	}

	var deleted []string
	for _, row := range existingRows {
		if !enumeratedSet[row.Path] {
			deleted = append(deleted, row.Path)
		}
	}
	if len(deleted) > 0 {
		if err := idx.store.DeleteFiles(ctx, idx.repoID, deleted); err != nil {
			return stats, err
		}
		for _, path := range deleted {
			idx.session.Forget(idx.absPath(path))
		}
		stats.FilesDeleted = len(deleted)
	}

	if err := idx.store.SetMeta(ctx, idx.repoID, "last_full_sync_at",
		strconv.FormatInt(time.Now().UnixMilli(), 10)); err != nil {
		return stats, err
	}
	return stats, nil
}

func (idx *Index) absPath(relPath string) string {
	return filepath.Join(idx.root, relPath)
}

// parseStale applies §5.3's staleness rule to every enumerated file and parses the stale ones
// through a bounded worker pool (§8), draining results into one writer (this function itself,
// single-threaded) — parsing is parallel, but nothing here writes to the store concurrently.
func (idx *Index) parseStale(
	ctx context.Context, enumerated []EnumeratedFile, existingByPath map[string]FileRow,
) ([]FileWrite, error) {
	type job struct {
		path string
		lang codeparse.ID
	}
	type outcome struct {
		write FileWrite
		err   error
	}

	jobs := make(chan job)
	outcomes := make(chan outcome)

	var wg sync.WaitGroup
	workers := syncWorkers()
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				w, err := idx.parseOne(ctx, j.path, j.lang)
				select {
				case outcomes <- outcome{write: w, err: err}:
				case <-ctx.Done():
					return
				}
			}
		}()
	}
	go func() {
		wg.Wait()
		close(outcomes)
	}()

	go func() {
		defer close(jobs)
		for _, e := range enumerated {
			if !idx.isStale(e.Path, existingByPath) {
				continue
			}
			select {
			case jobs <- job{path: e.Path, lang: e.Language}:
			case <-ctx.Done():
				return
			}
		}
	}()

	var writes []FileWrite
	var firstErr error
	for o := range outcomes {
		if o.err != nil {
			if firstErr == nil {
				firstErr = o.err
			}
			continue
		}
		writes = append(writes, o.write)
	}
	if firstErr != nil {
		return nil, firstErr
	}
	return writes, ctx.Err()
}

// isStale is §5.3: a file row is stale when its size_bytes or mtime_unix_ns disagrees with disk
// (content_sha is computed only once the file is actually read, below — never a second stat-only
// pass). A path with no existing row at all is always stale (it is new).
func (idx *Index) isStale(relPath string, existingByPath map[string]FileRow) bool {
	existing, had := existingByPath[relPath]
	if !had {
		return true
	}
	info, err := os.Stat(idx.absPath(relPath))
	if err != nil {
		// Vanished between enumeration and stat: not stale in the sense of "needs a fresh
		// parse" — the deletion pass (comparing against the enumerated set, not the disk)
		// is what removes its row, once `git ls-files` itself stops reporting it too.
		return false
	}
	return info.Size() != existing.SizeBytes || info.ModTime().UnixNano() != existing.MtimeUnixNs
}

// parseOne reads, classifies and (when supported) parses one file, returning the FileWrite Sync
// hands to the store. A read/stat failure is reported as parse_status='unreadable' rather than a
// hard error — Sync's own job is to make the cache agree with disk, and one unreadable file (a
// permission change, a broken symlink) must not abort the whole pass.
func (idx *Index) parseOne(ctx context.Context, relPath string, lang codeparse.ID) (FileWrite, error) {
	full := idx.absPath(relPath)
	info, statErr := os.Stat(full)
	if statErr != nil {
		return idx.unreadableWrite(relPath, lang), nil
	}

	content, sha, status := classifyAndRead(full)
	w := FileWrite{
		RepoID: idx.repoID, Path: relPath, Language: string(lang),
		SizeBytes: info.Size(), MtimeUnixNs: info.ModTime().UnixNano(),
		ContentSHA: sha[:], ParseStatus: status, ParsedAt: time.Now().UnixMilli(),
	}
	if status != StatusOK {
		return w, nil
	}

	result, err := idx.session.Parse(ctx, full, content, lang)
	if err != nil {
		// A genuine parse-pipeline error (a bad grammar registration, a cancelled context) is
		// still reported as unreadable rather than aborting the whole Sync — the file's row is
		// simply "we couldn't index this," retried on the next Sync.
		return idx.unreadableWrite(relPath, lang), nil
	}
	w.HasError = result.HasError
	w.LineCount = result.LineCount
	w.Blocks = result.Blocks
	w.Symbols = result.Symbols
	w.References = result.References
	return w, nil
}

func (idx *Index) unreadableWrite(relPath string, lang codeparse.ID) FileWrite {
	return FileWrite{
		RepoID: idx.repoID, Path: relPath, Language: string(lang),
		ParseStatus: StatusUnreadable, ParsedAt: time.Now().UnixMilli(),
		ContentSHA: make([]byte, 32),
	}
}

// classifyAndRead reads path (bounded to maxFileBytes+1) and classifies it per §5.4: a NUL byte in
// the first 8 KiB is binary; more than maxFileBytes is tooLarge — both get no content back (a
// tooLarge file's remaining bytes are streamed straight into the hash, never held in memory as a
// whole) but a real content_sha, computed over every byte read either way.
func classifyAndRead(path string) (content []byte, sha [32]byte, status ParseStatus) {
	f, err := os.Open(path)
	if err != nil {
		return nil, sha, StatusUnreadable
	}
	defer f.Close()

	buf := make([]byte, maxFileBytes+1)
	n, err := io.ReadFull(f, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, sha, StatusUnreadable
	}
	buf = buf[:n]

	if len(buf) > maxFileBytes {
		h := sha256.New()
		h.Write(buf)
		_, _ = io.Copy(h, f) // stream the remainder — a tooLarge file's bytes are never held whole.
		copy(sha[:], h.Sum(nil))
		return nil, sha, StatusTooLarge
	}

	probeLen := len(buf)
	if probeLen > binaryProbeBytes {
		probeLen = binaryProbeBytes
	}
	if bytes.IndexByte(buf[:probeLen], 0) >= 0 {
		sha = sha256.Sum256(buf)
		return nil, sha, StatusBinary
	}

	sha = sha256.Sum256(buf)
	return buf, sha, StatusOK
}

// parserFingerprintKey is the meta key §5.3 names.
const parserFingerprintKey = "parser_fingerprint"

// checkFingerprint is §5.3's own freshness check: a mismatch against the stored
// meta.parser_fingerprint means the extraction contract changed under this repository's stored
// rows (a grammar or vendored-query upgrade), so its rows are truncated and rebuilt from scratch
// rather than trusted. Never set before (a brand-new repository, or one indexed before this check
// existed) is not a mismatch — nothing to truncate, just record the current value.
func (idx *Index) checkFingerprint(ctx context.Context) error {
	current, err := codeparse.Fingerprint()
	if err != nil {
		return err
	}
	stored, had, err := idx.store.GetMeta(ctx, idx.repoID, parserFingerprintKey)
	if err != nil {
		return err
	}
	if had && stored == current {
		return nil
	}
	if had {
		if err := idx.store.DeleteRepo(ctx, idx.repoID); err != nil {
			return err
		}
	}
	return idx.store.SetMeta(ctx, idx.repoID, parserFingerprintKey, current)
}
