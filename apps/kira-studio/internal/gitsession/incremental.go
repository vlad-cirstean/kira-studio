package gitsession

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/catfile"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitreview"
)

// ErrBranchNotFound is RangeFiles/ReviewFileDiff/MarkFile's own answer when branch does not
// resolve against the cached refs snapshot — gitrpc maps this to E_BAD_REQUEST (D6).
var ErrBranchNotFound = errors.New("gitsession: branch not found in the ref snapshot")

// ErrUnrelatedHistories is RangeFiles/ReviewFileDiff's own guard for a raw socket client: SPEC's
// review.resolveBase already keeps the UI from ever reaching an unrelated (base, branch) pair, so
// this is server-side defence-in-depth, not a state the UI can reach (D13).
var ErrUnrelatedHistories = errors.New("gitsession: base and branch share no history")

// ErrRangedMarkOnNonText is review.mark's own refusal for a ranges-bearing mark against a file
// whose current content is not text — there is no line-numbered content to mark a sub-range of
// (D10/D13).
var ErrRangedMarkOnNonText = errors.New("gitsession: a ranged mark requires a text file")

// ReviewFileStatus mirrors @kira/git-ipc's own ReviewFileStatus (D13).
type ReviewFileStatus struct {
	Kind               string  `json:"kind"` // "none" | "partial" | "full"
	ChangedSinceReview bool    `json:"changedSinceReview"`
	ReviewedAt         *int64  `json:"reviewedAt,omitempty"`
	ReviewedAtSHA      *string `json:"reviewedAtSha,omitempty"`
}

// ReviewFileEntry mirrors @kira/git-ipc's own ReviewFileEntry.
type ReviewFileEntry struct {
	Change porcelain.FileChange `json:"change"`
	Review ReviewFileStatus     `json:"review"`
}

// RangeFilesResult is review.files' own wire result.
type RangeFilesResult struct {
	BranchTip string            `json:"branchTip"`
	MergeBase string            `json:"mergeBase"`
	Files     []ReviewFileEntry `json:"files"`
}

// ReviewFileDiffResult is review.fileDiff's own wire result.
type ReviewFileDiffResult struct {
	Path           string                 `json:"path"`
	DeltaSource    string                 `json:"deltaSource"`
	Body           porcelain.FileDiffBody `json:"body"`
	ReviewedRanges []gitreview.LineRange  `json:"reviewedRanges"`
	LineCount      int                    `json:"lineCount"`
	ReviewedAtSHA  *string                `json:"reviewedAtSha"`
}

// reviewFileStatus folds a stored record (or its absence) into the wire's ReviewFileStatus — a
// record whose State is "partial" with zero ranges (every reviewed line since unmarked) reads as
// "none": there is nothing left to call partially reviewed, even though the row itself persists
// (its reviewed_at_sha/blob_oid are still meaningful bookkeeping for the NEXT mark).
func reviewFileStatus(rec gitreview.FileRecord, found, changedSinceReview bool) ReviewFileStatus {
	if !found {
		return ReviewFileStatus{Kind: "none", ChangedSinceReview: false}
	}
	kind := "partial"
	switch {
	case rec.State == "full":
		kind = "full"
	case len(rec.Ranges) == 0:
		kind = "none"
	}
	if kind == "none" {
		changedSinceReview = false
	}
	millis := rec.ReviewedAt.UnixMilli()
	sha := rec.ReviewedAtSHA
	return ReviewFileStatus{
		Kind: kind, ChangedSinceReview: changedSinceReview, ReviewedAt: &millis, ReviewedAtSHA: &sha,
	}
}

// ReviewFileStatusFor converts a freshly-written FileRecord (review.mark's own return, gitrpc's
// only external caller) into the wire's ReviewFileStatus. changedSinceReview is always false
// immediately after a mark, since the record was just re-snapshotted against the branch tip
// (D10 step 4) — the record and the tip agree by construction.
func ReviewFileStatusFor(rec gitreview.FileRecord) ReviewFileStatus {
	return reviewFileStatus(rec, true, false)
}

// nonNilRanges guarantees the wire's `readonly LineRange[]` is `[]`, never `null` — ProjectRanges
// returns a nil slice for "nothing survived", which encoding/json marshals as `null`.
func nonNilRanges(ranges []gitreview.LineRange) []gitreview.LineRange {
	if ranges == nil {
		return []gitreview.LineRange{}
	}
	return ranges
}

// mergeBase is `merge-base <base> <branch>` (D6) — exit 0 the shared ancestor sha, exit 1
// "unrelated" (probe P2), anything else a classified error. sharesHistory (review.go) is now a
// thin wrapper over this: one helper, two callers, one spawn.
//
// G30 round-1 performance review, finding #8: this used to spawn `git merge-base` uncached on
// EVERY call — and RangeFiles (this method's own two production callers, review.files and
// review.fileDiff) calls it on nearly every request a review session makes, re-deriving the exact
// same (base, branch) answer over and over for the life of that session. Cached by (base, branch)
// ref-name pair through e.mergeBases (cache.go), dropped whole on refsChanged/invalidateAfterWrite
// exactly like refs/stack — an error is never cached (only a genuine exit-0/exit-1 result is a
// stable, cacheable fact).
func (e *RepoEntry) mergeBase(ctx context.Context, base, branch string) (string, bool, error) {
	if v, ok := e.mergeBases.get(base, branch); ok {
		return v.sha, v.ok, nil
	}
	res, err := e.runAllowingExit(ctx, porcelain.MergeBaseArgs(base, branch), 0, 1)
	if err != nil {
		return "", false, err
	}
	if res.ExitCode != 0 {
		e.mergeBases.set(base, branch, mergeBaseCacheValue{})
		return "", false, nil
	}
	sha := trimTrailingNewline(res.Stdout)
	e.mergeBases.set(base, branch, mergeBaseCacheValue{sha: sha, ok: true})
	return sha, true, nil
}

func trimTrailingNewline(b []byte) string {
	return string(bytes.TrimRight(b, "\n"))
}

// branchTip resolves branch's short name against the CACHED refs snapshot (no extra spawn beyond
// whatever populated it) — findBranchRef is review.go's own helper. ErrBranchNotFound for a name
// the snapshot does not contain.
func (e *RepoEntry) branchTip(ctx context.Context, branch string) (string, error) {
	snapshot, err := e.Refs(ctx)
	if err != nil {
		return "", err
	}
	ref, ok := findBranchRef(snapshot, branch)
	if !ok {
		return "", ErrBranchNotFound
	}
	return ref.ObjectID, nil
}

// blobOID resolves rev:path's current blob oid via the cat-file batch session, "" (not an error)
// for a path that does not exist there — the natural comparand for tier 0 (F6): ” vs. a record's
// own ” (ContentAbsent) is "still deleted", "unchanged" with no special case.
//
// G31 round-2 architecture/security review, finding #2 (queries.go's Blob, the same class of
// bug): a newline anywhere in `full` (rev included) desyncs the persistent --batch-check
// session's one-line-in-one-line-out protocol for every later caller sharing it, silently, for
// the life of the RepoEntry — routed through CheckOneShot instead, the --batch-check counterpart
// of readCurrentContent's own ReadOneShot fallback below.
func (e *RepoEntry) blobOID(ctx context.Context, rev, path string) (string, error) {
	session := e.CatFile()
	if session == nil {
		return "", ErrRepoTornDown
	}
	full := rev + ":" + path
	var info catfile.ObjectInfo
	var err error
	if strings.ContainsRune(full, '\n') {
		info, err = session.CheckOneShot(ctx, full)
	} else {
		info, err = session.Check(full)
	}
	if err != nil {
		if errors.Is(err, catfile.ErrMissing) {
			return "", nil
		}
		return "", err
	}
	return info.OID, nil
}

// blobOIDs resolves the current blob oid for every path in paths, at rev, in ONE --batch-check
// round trip rather than one per path (G30 round-1 performance review, finding #5) — RangeFiles'
// own review-status loop is the one caller that needs many of these at once, and a long-lived
// branch review with hundreds of previously-reviewed files paid one serialized pipe round trip
// per file before this. Same "" (not an error) contract as blobOID for a path that does not exist
// at rev; the returned slice is the same length as paths, in the same order.
func (e *RepoEntry) blobOIDs(ctx context.Context, rev string, paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	session := e.CatFile()
	if session == nil {
		return nil, ErrRepoTornDown
	}
	oids := make([]string, len(paths))
	// G31 round-2 architecture/security review, finding #2 (see blobOID's own doc comment): a
	// newline anywhere in one path would desync the whole shared --batch-check session for every
	// index after it in this same CheckMany round trip, not just its own answer. The overwhelming
	// common case (no newline in any path) still gets one batched round trip (G30 round-1
	// performance review, finding #5); the rare newline-containing path is pulled out and
	// resolved on its own via CheckOneShot instead, same "" (not an error) missing contract.
	var batchRevs []string
	var batchIndices []int
	for i, p := range paths {
		full := rev + ":" + p
		if strings.ContainsRune(full, '\n') {
			info, err := session.CheckOneShot(ctx, full)
			if err != nil {
				if errors.Is(err, catfile.ErrMissing) {
					continue // oids[i] stays "" — CheckMany's own zero-value-slot contract.
				}
				return nil, err
			}
			oids[i] = info.OID
			continue
		}
		batchRevs = append(batchRevs, full)
		batchIndices = append(batchIndices, i)
	}
	if len(batchRevs) > 0 {
		infos, err := session.CheckMany(batchRevs)
		if err != nil {
			return nil, err
		}
		for j, info := range infos {
			oids[batchIndices[j]] = info.OID
		}
	}
	return oids, nil
}

// readCurrentContent reads rev:path's content through the cat-file batch session, or the one-shot
// fallback for a path the batch protocol cannot express (a newline in the path, F5's own rarity
// note) — mirrors RepoEntry.Blob's own two-path shape.
//
// Also returns the blob's own OID (G31 round-2 performance review, finding #5): Read's own
// internal Check call already resolves it before fetching content, and MarkFile needs both the
// content (to classify/count lines) AND the OID (to compare against the stored record) for the
// exact same rev — discarding it here just to have blobOID re-resolve the identical rev via a
// second Check round trip a few lines later was a free pipe round trip to remove. ReadOneShot's
// own ObjectInfo never carries an OID (a one-shot `git show` has none to report), so the rare
// newline-in-rev path pays its own extra CheckOneShot call instead — still strictly fewer round
// trips than the two full Read+Check pairs the pre-fix code paid even in the common case.
func (e *RepoEntry) readCurrentContent(ctx context.Context, rev, path string) (string, []byte, error) {
	session := e.CatFile()
	if session == nil {
		return "", nil, ErrRepoTornDown
	}
	full := rev + ":" + path
	// G31 round-2 architecture/security review, finding #2 (see blobOID's own doc comment): a
	// newline in `rev`, not only `path`, needs the one-shot fallback too — `full` is what
	// actually crosses the batch protocol's one-line framing.
	if strings.ContainsRune(full, '\n') {
		_, content, err := session.ReadOneShot(ctx, full)
		if err != nil {
			return "", nil, err
		}
		info, err := session.CheckOneShot(ctx, full)
		if err != nil {
			return "", nil, err
		}
		return info.OID, content, nil
	}
	info, content, err := session.Read(full)
	return info.OID, content, err
}

// countLines counts a text blob's own line count — the number of '\n' bytes, plus one more when
// the content does not itself end in one (an unterminated final line is still a line).
func countLines(content []byte) int {
	if len(content) == 0 {
		return 0
	}
	n := bytes.Count(content, []byte("\n"))
	if content[len(content)-1] != '\n' {
		n++
	}
	return n
}

// readSnapshotSource resolves tip:path's content and classifies it exactly as a snapshot is
// classified at mark time (D9): ContentAbsent for a path git cannot resolve there, ContentTooLarge
// over the cap (either MaxSnapshotBytes or the cat-file session's own 10 MiB gate), ContentBinary
// via the NUL sniff, else ContentText with the content and its line count. Only ContentText's
// content/lineCount are meaningful; every other kind returns (kind, nil, 0, nil).
//
// Also returns the blob's own OID whenever content was actually read (G31 round-2 performance
// review, finding #5) — readCurrentContent's own doc comment explains why this piggybacks for
// free; "" for every kind that never called readCurrentContent's content path.
func (e *RepoEntry) readSnapshotSource(ctx context.Context, tip, path string) (gitreview.ContentKind, []byte, int, string, error) {
	oid, content, err := e.readCurrentContent(ctx, tip, path)
	if err != nil {
		if errors.Is(err, catfile.ErrMissing) {
			return gitreview.ContentAbsent, nil, 0, "", nil
		}
		if errors.Is(err, catfile.ErrTooLarge) {
			// Read's own size gate (session.go) still resolves and returns the OID via Check
			// before skipping the content fetch — oid is valid here, not "".
			return gitreview.ContentTooLarge, nil, 0, oid, nil
		}
		return "", nil, 0, "", err
	}
	if int64(len(content)) > gitreview.MaxSnapshotBytes {
		return gitreview.ContentTooLarge, nil, 0, oid, nil
	}
	if looksBinary(content) {
		return gitreview.ContentBinary, nil, 0, oid, nil
	}
	return gitreview.ContentText, content, countLines(content), oid, nil
}

// sumHunkDelta is the running total D7's tier-1 arithmetic needs: a file's new line count equals
// its old line count plus the sum of every hunk's own (NewLines - OldLines), since a diff covering
// the WHOLE file accounts for every line that moved.
func sumHunkDelta(hunks []porcelain.DiffHunk) int {
	total := 0
	for _, h := range hunks {
		total += h.NewLines - h.OldLines
	}
	return total
}

// deltaResult is FileDelta's own result — D7's three tiers reduced to one shape every caller reads
// the same way.
type deltaResult struct {
	Source           string // "unchanged" | "fast" | "slow" | "snapshotUnavailable"
	Hunks            []porcelain.DiffHunk
	Body             porcelain.FileDiffBody
	CurrentOID       string
	CurrentLineCount int
}

// parseAndResolve is FileDiff's own marshal-once shape, reused: MaxPatchBytes first (never handed
// to the parser), then ParseFileDiffBody, then resolveParsedBody's binary-byte-count round trip.
func (e *RepoEntry) parseAndResolve(raw []byte) (porcelain.ParsedBody, porcelain.FileDiffBody, error) {
	if int64(len(raw)) > MaxPatchBytes {
		return porcelain.ParsedBody{}, porcelain.FileDiffBody{
			Kind: porcelain.BodyTooLarge, Bytes: int64(len(raw)), LimitBytes: MaxPatchBytes,
		}, nil
	}
	parsed, err := porcelain.ParseFileDiffBody(raw)
	if err != nil {
		return porcelain.ParsedBody{}, porcelain.FileDiffBody{}, err
	}
	body, err := e.resolveParsedBody(parsed)
	if err != nil {
		return porcelain.ParsedBody{}, porcelain.FileDiffBody{}, err
	}
	return parsed, body, nil
}

// FileDelta is D7's three-tier "what changed since you reviewed" selection, verbatim:
//
//  0. blob-oid equality (F6) — exact, no diff at all, and the only tier that answers correctly
//     when the snapshot commit has been pruned AND the content is unchanged.
//  1. merge-base --is-ancestor: the snapshot sha is still reachable, an ordinary git diff is
//     exact and the stored blob is never read.
//  2. diff --no-index against the decompressed stored blob: history was rewritten (exit 1, the
//     common amend/rebase/squash case, probe P2) or the sha is genuinely pruned (exit 128) — both
//     take the slow path. A non-text snapshot has nothing to diff against: snapshotUnavailable.
//
// Do not collapse this to two tiers — tier 0 is not an optimisation, it is the only tier that
// answers correctly when the snapshot commit is pruned AND unchanged, and it is what keeps
// RangeFiles from spawning a diff per file (D7/D18).
func (e *RepoEntry) FileDelta(ctx context.Context, branch, path string, rec gitreview.FileRecord, snapshot []byte, tip string) (deltaResult, error) {
	currentOID, err := e.blobOID(ctx, tip, path)
	if err != nil {
		return deltaResult{}, err
	}

	if currentOID == rec.BlobOID {
		return deltaResult{
			Source:           "unchanged",
			Body:             porcelain.FileDiffBody{Kind: porcelain.BodyEmpty, Reason: "identical"},
			CurrentOID:       currentOID,
			CurrentLineCount: rec.LineCount,
		}, nil
	}

	ancestorRes, err := e.runAllowingExit(ctx, porcelain.IsAncestorArgs(rec.ReviewedAtSHA, branch), 0, 1, 128)
	if err != nil {
		return deltaResult{}, err
	}

	if ancestorRes.ExitCode == 0 {
		raw, err := e.runOne(ctx, porcelain.FileDiffArgs(&rec.ReviewedAtSHA, tip, path, nil))
		if err != nil {
			return deltaResult{}, err
		}
		parsed, body, err := e.parseAndResolve(raw)
		if err != nil {
			return deltaResult{}, err
		}
		// G31 round-2 functional-correctness review, finding #7: parseAndResolve's own
		// MaxPatchBytes gate returns a zero-value ParsedBody (no hunks) for BodyTooLarge, so
		// `rec.LineCount + sumHunkDelta(nil)` silently equals rec.LineCount — the SNAPSHOT's line
		// count for a file that ancestorRes.ExitCode == 0 already proved changed. That stale
		// estimate then overwrote MarkFile's own freshly-measured snapshotLineCount and clamped
		// ProjectRanges/reviewMarking.ts's own clampRanges to the wrong length, silently
		// truncating or no-oping a mark past the estimate's own too-short bound. The slow path and
		// the noSnapshot path both already measure the real count directly; do the same here
		// instead of estimating from hunks that were never parsed.
		currentLineCount := rec.LineCount + sumHunkDelta(parsed.Hunks)
		if body.Kind == porcelain.BodyTooLarge {
			_, currentContent, cerr := e.readCurrentContent(ctx, tip, path)
			if cerr != nil {
				return deltaResult{}, cerr
			}
			currentLineCount = countLines(currentContent)
		}
		return deltaResult{
			Source: "fast", Hunks: parsed.Hunks, Body: body, CurrentOID: currentOID,
			CurrentLineCount: currentLineCount,
		}, nil
	}

	// Tier 2: exit 1 (unreachable but present, the common rewrite case) or exit 128 (genuinely
	// pruned) both take the slow path — F4. A missing BRANCH is a different failure and cannot
	// reach here: the tip was already resolved from the cached refs snapshot before this ran.
	if rec.ContentKind != gitreview.ContentText {
		return deltaResult{
			Source:           "snapshotUnavailable",
			Body:             porcelain.FileDiffBody{Kind: porcelain.BodyEmpty, Reason: "identical"},
			CurrentOID:       currentOID,
			CurrentLineCount: rec.LineCount,
		}, nil
	}

	_, currentContent, err := e.readCurrentContent(ctx, tip, path)
	if err != nil {
		if errors.Is(err, catfile.ErrMissing) {
			currentContent = nil
		} else {
			return deltaResult{}, err
		}
	}

	dir, err := os.MkdirTemp("", "kira-review-")
	if err != nil {
		return deltaResult{}, fmt.Errorf("gitsession: create review temp dir: %w", err)
	}
	defer os.RemoveAll(dir)

	oldPath, newPath := filepath.Join(dir, "old"), filepath.Join(dir, "new")
	if err := os.WriteFile(oldPath, snapshot, 0o600); err != nil {
		return deltaResult{}, fmt.Errorf("gitsession: write review snapshot: %w", err)
	}
	if err := os.WriteFile(newPath, currentContent, 0o600); err != nil {
		return deltaResult{}, fmt.Errorf("gitsession: write review current content: %w", err)
	}

	res, err := e.runAllowingExit(ctx, porcelain.NoIndexDiffArgs(oldPath, newPath), 0, 1)
	if err != nil {
		return deltaResult{}, err
	}
	parsed, body, err := e.parseAndResolve(res.Stdout)
	if err != nil {
		return deltaResult{}, err
	}
	return deltaResult{
		Source: "slow", Hunks: parsed.Hunks, Body: body, CurrentOID: currentOID,
		CurrentLineCount: countLines(currentContent),
	}, nil
}

// recordRanges returns rec's ranges in snapshot coordinates — Expand(rec.LineCount) for a "full"
// record (D10's own "Expand is the only thing that turns [state=full] into a materialised range").
func recordRanges(rec gitreview.FileRecord) []gitreview.LineRange {
	if rec.State == "full" {
		return gitreview.Expand(rec.LineCount)
	}
	return rec.Ranges
}

// rangeFileDiffBody is the <mergeBase>..<branchTip> patch for one file — D13's "mode: range" body,
// through the EXISTING RepoEntry.diff cache (keyed (mergeBase, tip, path), F2): two tree oids and
// a path determine a patch forever, so this is the same cache commit.fileDiff already warms.
func (e *RepoEntry) rangeFileDiffBody(ctx context.Context, mergeBase, tip, path string) (porcelain.FileDiffBody, error) {
	if body, _, ok := e.diff.get(mergeBase, tip, path); ok {
		return body, nil
	}
	raw, err := e.runOne(ctx, porcelain.FileDiffArgs(&mergeBase, tip, path, nil))
	if err != nil {
		return porcelain.FileDiffBody{}, err
	}
	_, body, err := e.parseAndResolve(raw)
	if err != nil {
		return porcelain.FileDiffBody{}, err
	}
	e.diff.set(mergeBase, tip, path, body, int64(len(raw)))
	return body, nil
}

// RangeFiles is review.files' own orchestration (D6): the range's file list — the exact pair
// CommitDetail already runs, run concurrently — joined against every stored record's tier-0
// (blob-oid) check, so a per-file "has this changed since you reviewed it" answer costs one pipe
// round trip, never a diff, for every file that has a record (F6).
func (e *RepoEntry) RangeFiles(ctx context.Context, base, branch string) (RangeFilesResult, error) {
	tip, err := e.branchTip(ctx, branch)
	if err != nil {
		return RangeFilesResult{}, err
	}
	mb, ok, err := e.mergeBase(ctx, base, branch)
	if err != nil {
		return RangeFilesResult{}, err
	}
	if !ok {
		return RangeFilesResult{}, ErrUnrelatedHistories
	}

	var numstat []porcelain.NumstatEntry
	var nameStatus []porcelain.NameStatusEntry
	var spawnErrs [2]error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		raw, rerr := e.runOne(ctx, porcelain.NumstatArgs(&mb, tip))
		if rerr != nil {
			spawnErrs[0] = rerr
			return
		}
		recs, rerr := allRecords(raw)
		if rerr != nil {
			spawnErrs[0] = rerr
			return
		}
		numstat, spawnErrs[0] = porcelain.ParseNumstatRecords(recs)
	}()
	go func() {
		defer wg.Done()
		raw, rerr := e.runOne(ctx, porcelain.NameStatusArgs(&mb, tip))
		if rerr != nil {
			spawnErrs[1] = rerr
			return
		}
		recs, rerr := allRecords(raw)
		if rerr != nil {
			spawnErrs[1] = rerr
			return
		}
		nameStatus, spawnErrs[1] = porcelain.ParseNameStatusRecords(recs)
	}()
	wg.Wait()
	for _, spawnErr := range spawnErrs {
		if spawnErr != nil {
			return RangeFilesResult{}, spawnErr
		}
	}
	changes := porcelain.CombineFileChanges(numstat, nameStatus)

	records, err := e.review.Records(ctx, e.Summary.RepoID, branch)
	if err != nil {
		return RangeFilesResult{}, err
	}

	// G30 round-1 performance review, finding #5: one batched CheckMany round trip for every
	// changed file that actually has a stored review record, instead of one blobOID round trip
	// per such file in the loop below.
	var needsOID []string
	for _, ch := range changes {
		if _, hasRecord := records[ch.Path]; hasRecord {
			needsOID = append(needsOID, ch.Path)
		}
	}
	oids, err := e.blobOIDs(ctx, tip, needsOID)
	if err != nil {
		return RangeFilesResult{}, err
	}
	oidByPath := make(map[string]string, len(needsOID))
	for i, p := range needsOID {
		oidByPath[p] = oids[i]
	}

	entries := make([]ReviewFileEntry, 0, len(changes))
	for _, ch := range changes {
		rec, hasRecord := records[ch.Path]
		var status ReviewFileStatus
		if !hasRecord {
			status = ReviewFileStatus{Kind: "none", ChangedSinceReview: false}
		} else {
			currentOID := oidByPath[ch.Path]
			status = reviewFileStatus(rec, true, currentOID != rec.BlobOID)
		}
		entries = append(entries, ReviewFileEntry{Change: ch, Review: status})
	}

	if err := e.review.Touch(ctx, e.Summary.RepoID, branch); err != nil {
		return RangeFilesResult{}, err
	}

	return RangeFilesResult{BranchTip: tip, MergeBase: mb, Files: entries}, nil
}

// ReviewFileDiff is review.fileDiff's own orchestration (D13): the delta selection runs in BOTH
// modes (reviewedRanges needs the projection either way); mode decides only which patch becomes
// body — the range diff, or the delta FileDelta already computed. deltaSource always describes the
// projection, never the body.
func (e *RepoEntry) ReviewFileDiff(ctx context.Context, base, branch, path, mode string) (ReviewFileDiffResult, error) {
	tip, err := e.branchTip(ctx, branch)
	if err != nil {
		return ReviewFileDiffResult{}, err
	}
	mb, ok, err := e.mergeBase(ctx, base, branch)
	if err != nil {
		return ReviewFileDiffResult{}, err
	}
	if !ok {
		return ReviewFileDiffResult{}, ErrUnrelatedHistories
	}

	rec, snapshot, found, err := e.review.Record(ctx, e.Summary.RepoID, branch, path)
	if err != nil {
		return ReviewFileDiffResult{}, err
	}

	if !found {
		// noSnapshot: "what changed since you last reviewed" when you never reviewed it IS the
		// whole range diff — returning an empty body here would be a lie dressed as a degradation.
		rangeBody, err := e.rangeFileDiffBody(ctx, mb, tip, path)
		if err != nil {
			return ReviewFileDiffResult{}, err
		}
		_, _, lineCount, _, err := e.readSnapshotSource(ctx, tip, path)
		if err != nil {
			return ReviewFileDiffResult{}, err
		}
		return ReviewFileDiffResult{
			Path: path, DeltaSource: "noSnapshot", Body: rangeBody,
			ReviewedRanges: []gitreview.LineRange{}, LineCount: lineCount, ReviewedAtSHA: nil,
		}, nil
	}

	delta, err := e.FileDelta(ctx, branch, path, rec, snapshot, tip)
	if err != nil {
		return ReviewFileDiffResult{}, err
	}
	reviewedRanges := nonNilRanges(gitreview.ProjectRanges(recordRanges(rec), delta.Hunks, delta.CurrentLineCount))

	body := delta.Body
	if mode == "range" {
		rangeBody, err := e.rangeFileDiffBody(ctx, mb, tip, path)
		if err != nil {
			return ReviewFileDiffResult{}, err
		}
		body = rangeBody
	}

	sha := rec.ReviewedAtSHA
	return ReviewFileDiffResult{
		Path: path, DeltaSource: delta.Source, Body: body,
		ReviewedRanges: reviewedRanges, LineCount: delta.CurrentLineCount, ReviewedAtSHA: &sha,
	}, nil
}

// normalizeState turns a computed range set into the schema's own (state, ranges) shape: a range
// set that covers every line of the current file is stored as "full" (a state, not a materialised
// [1..N] range, D10); anything smaller (including empty — nothing reviewed) is "partial" with its
// concrete ranges.
func normalizeState(next []gitreview.LineRange, lineCount int) (string, []gitreview.LineRange) {
	if lineCount > 0 && gitreview.CountLines(next) == lineCount {
		return "full", nil
	}
	return "partial", next
}

// MarkFile is review.mark's whole orchestration (D10), entirely inside Store.Lock(repoID, branch,
// path) (D12) — the whole read-diff-write, including the git work FileDelta and the re-snapshot
// read do, runs under this file's own keyed mutex, never a database transaction alone.
func (e *RepoEntry) MarkFile(ctx context.Context, branch, path string, reviewed bool, ranges []gitreview.LineRange) (gitreview.FileRecord, error) {
	unlock := e.review.Lock(e.Summary.RepoID, branch, path)
	defer unlock()

	tip, err := e.branchTip(ctx, branch)
	if err != nil {
		return gitreview.FileRecord{}, err
	}

	// G31 round-2 performance review, finding #5: currentOID comes straight off
	// readSnapshotSource's own return now, instead of a second, separately-spawned blobOID call
	// for the identical tip:path — readCurrentContent's own doc comment explains why the OID was
	// already sitting there for free.
	contentKind, content, snapshotLineCount, currentOID, err := e.readSnapshotSource(ctx, tip, path)
	if err != nil {
		return gitreview.FileRecord{}, err
	}
	if ranges != nil && contentKind != gitreview.ContentText {
		return gitreview.FileRecord{}, ErrRangedMarkOnNonText
	}

	existingRec, snapshot, found, err := e.review.Record(ctx, e.Summary.RepoID, branch, path)
	if err != nil {
		return gitreview.FileRecord{}, err
	}

	currentLineCount := snapshotLineCount
	var existing []gitreview.LineRange
	if found {
		delta, derr := e.FileDelta(ctx, branch, path, existingRec, snapshot, tip)
		if derr != nil {
			return gitreview.FileRecord{}, derr
		}
		existing = gitreview.ProjectRanges(recordRanges(existingRec), delta.Hunks, delta.CurrentLineCount)
		if contentKind == gitreview.ContentText {
			currentLineCount = delta.CurrentLineCount
		}
	}

	// D10's "given absent => the whole file" used to materialize as gitreview.Expand(currentLineCount)
	// and rely on normalizeState's own CountLines(next) == lineCount check to fold that back into
	// "full". That breaks for any file that snapshots at lineCount 0 — deleted at the branch tip,
	// binary, too-large, or genuinely empty (G30 round-1 functional-correctness review, finding
	// #1): Expand(0) is nil, so `next` is empty regardless of `reviewed`, and normalizeState reads
	// an empty range set as "partial" with no ranges, which reviewFileStatus maps straight back to
	// "none" — the file can never be marked reviewed. "the whole file" is a state, not a
	// materialized range, so it is set directly here, independent of whether this file currently
	// has any lines to materialize a range over.
	var state string
	var storedRanges []gitreview.LineRange
	if ranges == nil {
		if reviewed {
			state, storedRanges = "full", nil
		} else {
			state, storedRanges = "partial", nil
		}
	} else {
		// A real ranged mark — only reachable for a text file (ErrRangedMarkOnNonText above), so
		// normalizeState's own lineCount-based "did this cover everything" check is meaningful here.
		given := gitreview.ProjectRanges(ranges, nil, currentLineCount)
		var next []gitreview.LineRange
		if reviewed {
			next = gitreview.Union(existing, given)
		} else {
			next = gitreview.Subtract(existing, given)
		}
		state, storedRanges = normalizeState(next, currentLineCount)
	}

	rec := gitreview.FileRecord{
		Path: path, State: state, ReviewedAtSHA: tip, ReviewedAt: time.Now(),
		BlobOID: currentOID, ContentKind: contentKind, ContentBytes: len(content),
		LineCount: currentLineCount, Ranges: storedRanges,
	}
	if err := e.review.Put(ctx, e.Summary.RepoID, branch, rec, content); err != nil {
		return gitreview.FileRecord{}, err
	}
	return rec, nil
}
