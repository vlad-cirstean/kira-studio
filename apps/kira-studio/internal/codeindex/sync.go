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
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/pathsafe"
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

// SyncState is one Index's own full-reconcile state (P67f §2.2). A caller that can see it can tell
// "no rows for that name" from "the index is mid-rebuild" or "the last rebuild failed" — which
// nothing outside codeindex could do before.
type SyncState struct {
	InFlight bool
	// Generation counts completed full Sync attempts, successful or not (endSync increments it
	// unconditionally, deliberately: sync_concurrency_test.go's own TestSyncState asserts
	// Generation advances after a failed Sync too, so a caller can tell "no Sync has run yet"
	// apart from "the last Sync failed" purely from Generation == 0 vs > 0, without having to
	// also check LastErr). 0 means none has finished yet.
	Generation uint64
	LastErr    error // the last completed full Sync's own error, nil on success
	LastDoneAt time.Time
}

// syncTracker is a counter, not a bool: the initial sync and a watcher rescan can genuinely
// overlap (server.go starts one in a goroutine while watch.go can start another), so "settled"
// means the count is back to zero, not that some particular Sync finished.
type syncTracker struct {
	mu       sync.Mutex
	inFlight int
	settled  chan struct{} // closed exactly while inFlight == 0
	gen      uint64
	lastErr  error
	lastDone time.Time
}

// beginSync records one more full Sync starting — called once at the top of Sync, before any of
// its own work.
func (idx *Index) beginSync() {
	idx.sync.mu.Lock()
	defer idx.sync.mu.Unlock()
	if idx.sync.inFlight == 0 {
		idx.sync.settled = make(chan struct{})
	}
	idx.sync.inFlight++
}

// endSync records one full Sync's own completion — deferred from Sync, so it runs whether Sync
// returned nil or an error.
func (idx *Index) endSync(err error) {
	idx.sync.mu.Lock()
	defer idx.sync.mu.Unlock()
	idx.sync.inFlight--
	idx.sync.lastErr = err
	idx.sync.lastDone = time.Now()
	idx.sync.gen++
	if idx.sync.inFlight == 0 {
		close(idx.sync.settled)
	}
}

// SyncSettled returns a channel closed once no full Sync is in flight — already closed when none
// is. Inherently a snapshot: a Sync can begin the instant after it is read.
func (idx *Index) SyncSettled() <-chan struct{} {
	idx.sync.mu.Lock()
	defer idx.sync.mu.Unlock()
	return idx.sync.settled
}

// SyncState snapshots the last completed full Sync's own outcome.
func (idx *Index) SyncState() SyncState {
	idx.sync.mu.Lock()
	defer idx.sync.mu.Unlock()
	return SyncState{
		InFlight:   idx.sync.inFlight > 0,
		Generation: idx.sync.gen,
		LastErr:    idx.sync.lastErr,
		LastDoneAt: idx.sync.lastDone,
	}
}

// Sync is one reconcile pass (§6): enumerate, apply §5.3's staleness rules and parse the stale
// ones, delete rows for paths that left enumeration, and record meta.last_full_sync_at. Brackets
// itself against idx.sync (P67f §2.2) so a caller elsewhere (repomap's own waitReady) can wait out
// or notice this Sync — the initial one and every later watcher-triggered rescan alike, since both
// go through this one method.
func (idx *Index) Sync(ctx context.Context) (stats SyncStats, err error) {
	idx.beginSync()
	defer func() { idx.endSync(err) }()

	stats = SyncStats{ByLanguage: map[codeparse.ID]int{}}

	if err := idx.checkFingerprint(ctx); err != nil {
		return stats, err
	}
	// meta.repo_root (C2 §4.1): a second process (C3's MCP server) has no gitclient.Runner and
	// no way to reach gitclient's own identity function, so this is the only path from a
	// worktree path to a repo_id once that process opens the same codeindex.db.
	if err := idx.store.SetMeta(ctx, idx.repoID, repoRootKey, idx.root); err != nil {
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

	if err := idx.parseStale(ctx, enumerated, existingByPath, &stats); err != nil {
		return stats, err
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

	now := strconv.FormatInt(time.Now().UnixMilli(), 10)
	if err := idx.store.SetMeta(ctx, idx.repoID, "last_full_sync_at", now); err != nil {
		return stats, err
	}
	if err := idx.touch(ctx, now); err != nil {
		return stats, err
	}
	return stats, nil
}

// touch records this repository as just used (§5.4's idle-repository sweep oracle, reaper.go) —
// called by every Sync and by the watcher's own per-event work, so a repository under active,
// watcher-driven editing with no full Sync in between still counts as recently used.
func (idx *Index) touch(ctx context.Context, nowMillis string) error {
	return idx.store.SetMeta(ctx, idx.repoID, "last_used_at", nowMillis)
}

func (idx *Index) absPath(relPath string) string {
	return filepath.Join(idx.root, relPath)
}

// parseStale applies §5.3's staleness rule to every enumerated file and parses the stale ones
// through a bounded worker pool (§8), streaming each finished FileWrite to a single writer
// goroutine (below) that batches them into replaceFileBatch-sized transactions as parsing
// continues — overlapping the parse and write phases instead of materializing every write before
// any of them land (P64c §2.1: 3.51s -> ~2.30s on this repository, peak retained heap 153 MiB ->
// a few). Parsing is parallel; nothing here writes to the store concurrently — exactly one writer
// goroutine ever calls the store, preserving the single-writer invariant this doc comment already
// stated before the pipelining (SQLite itself is single-writer, and §1.5's own measurement shows
// concurrent writers only serialize, never help).
//
// stats accumulates in the writer goroutine as each batch lands, rather than in a second pass over
// a materialized slice — safe because it is the only goroutine that ever touches stats.
//
// Error cancellation runs both directions: a parse error stops the writer from waiting on a
// channel nothing will ever add to again, and a writer error (a batch write that fails) cancels
// the shared cancelWriter context so parse workers and the enumerator — both blocked sending on a
// channel the writer has stopped draining — unblock instead of hanging. The first error from
// either side wins and is returned, matching this function's pre-pipelining firstErr semantics.
func (idx *Index) parseStale(
	ctx context.Context, enumerated []EnumeratedFile, existingByPath map[string]FileRow, stats *SyncStats,
) error {
	type job struct {
		path string
		lang codeparse.ID
	}

	jobs := make(chan job)
	// Buffered at one batch's own width: the writer goroutine below spends most of a flush
	// blocked inside a single synchronous replaceFilesTx call, not looping on outcomes at all —
	// an unbuffered channel would stall every parse worker for that whole duration (measured: it
	// collapses the pipeline back to sequential, 3.3s+ on this repository, no better than before
	// pipelining). A full batch of slack lets parse keep producing the *next* batch while the
	// writer is busy committing the current one, which is the actual overlap P64c §2.1 measures.
	outcomes := make(chan parseOutcome, replaceFileBatch)

	// writerCtx cancels the parse side (worker sends and the enumerator's own job sends) the
	// moment the writer goroutine hits an error it cannot recover from, without touching ctx
	// itself — a cancelled parent ctx still reaches here too, since writerCtx is derived from it.
	writerCtx, cancelWriter := context.WithCancel(ctx)
	defer cancelWriter()

	var wg sync.WaitGroup
	workers := syncWorkers()
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				w, ok, err := idx.parseOne(ctx, j.path, j.lang)
				select {
				case outcomes <- parseOutcome{write: w, ok: ok, err: err}:
				case <-writerCtx.Done():
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
			case <-writerCtx.Done():
				return
			}
		}
	}()

	return idx.writeOutcomes(ctx, outcomes, cancelWriter, stats)
}

// parseOutcome is one worker's own report back to the writer goroutine — ok is false only for
// parseOne's C13-8 path-safety skip (no row to write, not an error); every other combination
// writes a row (err set means abort, otherwise write is ready to batch).
type parseOutcome struct {
	write FileWrite
	ok    bool
	err   error
}

// writeOutcomes is parseStale's single writer goroutine — this function's own caller runs it
// directly (it blocks until outcomes closes), rather than spawning yet another goroutine, since
// parseStale has nothing left to do but wait for it anyway. Batches FileWrites into
// replaceFileBatch-sized transactions as they arrive and calls cancelOnErr once, the first time
// either a parse outcome or a batch write itself fails, so the parse side unblocks instead of
// hanging on a channel this function has stopped draining productively (it keeps ranging over
// outcomes after an error purely to let blocked senders finish and the channel close — never
// writing again once firstErr is set).
func (idx *Index) writeOutcomes(
	ctx context.Context, outcomes <-chan parseOutcome, cancelOnErr context.CancelFunc, stats *SyncStats,
) error {
	batch := make([]FileWrite, 0, replaceFileBatch)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		if err := idx.store.writeBatch(ctx, batch); err != nil {
			return err
		}
		for _, w := range batch {
			if w.ParseStatus != StatusOK {
				stats.FilesSkipped++
			} else {
				stats.FilesParsed++
			}
			stats.ByLanguage[codeparse.ID(w.Language)]++
		}
		batch = batch[:0]
		return nil
	}

	var firstErr error
	for o := range outcomes {
		if firstErr != nil {
			continue // draining only, so blocked parse workers can finish and outcomes can close.
		}
		if o.err != nil {
			firstErr = o.err
			cancelOnErr()
			continue
		}
		if !o.ok {
			continue
		}
		batch = append(batch, o.write)
		if len(batch) >= replaceFileBatch {
			if err := flush(); err != nil {
				firstErr = err
				cancelOnErr()
			}
		}
	}
	if firstErr == nil {
		if err := flush(); err != nil {
			firstErr = err
		}
	}
	if firstErr != nil {
		return firstErr
	}
	return ctx.Err()
}

// isStale is §5.3: a file row is stale when its size_bytes or mtime_unix_ns disagrees with disk
// (content_sha is computed only once the file is actually read, below — never a second stat-only
// pass). A path with no existing row at all is always stale (it is new).
func (idx *Index) isStale(relPath string, existingByPath map[string]FileRow) bool {
	existing, had := existingByPath[relPath]
	if !had {
		return true
	}
	// C13-8: a path resolving outside idx.root (most likely a committed/untracked symlink) is
	// never stat'd — pathsafe.ValidateRelPath, the same gate parseOne applies before actually
	// opening it. Treated like the vanished-file case below: parseOne's own identical check is
	// what actually matters (this is only enqueue-side, avoiding a doomed job).
	full, err := pathsafe.ValidateRelPath(idx.root, relPath)
	if err != nil {
		return false
	}
	info, err := os.Stat(full)
	if err != nil {
		// Vanished between enumeration and stat: not stale in the sense of "needs a fresh
		// parse" — the deletion pass (comparing against the enumerated set, not the disk)
		// is what removes its row, once `git ls-files` itself stops reporting it too.
		return false
	}
	return !existing.MatchesDisk(info)
}

// parseOne reads, classifies and (when supported) parses one file, returning the FileWrite the
// caller hands to the store — Sync's own stale-file pass and the watcher's per-file reparse both
// go through this one path. A read/stat failure is reported as parse_status='unreadable' rather
// than a hard error — the caller's job is to make the cache agree with disk, and one unreadable
// file (a permission change, a broken symlink) must not abort a whole Sync pass.
//
// The returned bool is false only for C13-8's own gate: a path resolving outside idx.root (a
// symlink escaping the repository) is skipped entirely, silently, with no row written at all —
// unlike a plain stat/read failure, which still gets an unreadable row (§5.4's own convention).
// Every caller must check it before writing w to the store.
//
// Reparse rather than Parse: Session.Reparse already falls back to a fresh Parse when nothing is
// resident for this path (first sync, or an evicted entry), so calling it unconditionally here —
// rather than branching on whether this is "the first time" — gets every file the incremental
// path for free the moment something keeps its tree resident (a prior Sync, or the watcher).
func (idx *Index) parseOne(ctx context.Context, relPath string, lang codeparse.ID) (FileWrite, bool, error) {
	full, err := pathsafe.ValidateRelPath(idx.root, relPath)
	if err != nil {
		// Mirrors codeworkspace/search.go's own gate 1: skip, don't read through it, and don't
		// abort the whole Sync/watch pass over it either — it is simply never indexed.
		return FileWrite{}, false, nil
	}
	info, statErr := os.Stat(full)
	if statErr != nil {
		return idx.unreadableWrite(relPath, lang), true, nil
	}

	content, sha, status := classifyAndRead(full)
	w := FileWrite{
		RepoID: idx.repoID, Path: relPath, Language: string(lang),
		SizeBytes: info.Size(), MtimeUnixNs: info.ModTime().UnixNano(),
		ContentSHA: sha[:], ParseStatus: status, ParsedAt: time.Now().UnixMilli(),
	}
	if status != StatusOK {
		return w, true, nil
	}

	result, err := idx.session.Reparse(ctx, full, content, lang)
	if err != nil {
		// A genuine parse-pipeline error (a bad grammar registration, a cancelled context) is
		// still reported as unreadable rather than aborting the whole Sync — the file's row is
		// simply "we couldn't index this," retried on the next Sync.
		return idx.unreadableWrite(relPath, lang), true, nil
	}
	w.HasError = result.HasError
	w.LineCount = result.LineCount
	w.Blocks = result.Blocks
	w.Symbols = result.Symbols
	w.References = result.References
	return w, true, nil
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

// repoRootKey is C2 §4.1's meta key: a repository's own worktree root, so Store.ListRepos can map
// a path to a repo_id without gitclient (C3's own separate process has no Runner).
const repoRootKey = "repo_root"

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
