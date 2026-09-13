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

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/catfile"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// MaxPatchBytes is D2(b)'s own domain cap on one file's raw patch — upstream's own 1 MiB
// (repoService.ts:285). A patch over this never reaches ParseFileDiffBody at all; the wire answer
// is FileDiffBody's own "tooLarge" arm, never a transport error.
const MaxPatchBytes = 1 << 20

// ErrParentIndexOutOfRange is CommitDetail/FileDiff's own answer to a parentIndex the caller could
// not possibly have gotten from a previous result's own `parents` array — a BadRequest, never a
// silent clamp (gitrpc maps this to E_BAD_REQUEST).
var ErrParentIndexOutOfRange = errors.New("gitsession: parentIndex is out of range")

// ErrFileNotInCommit is FileDiff's own answer for a path that is not one of sha's changed files —
// the webview only ever passes a path it read out of the same commit's own `files` list, so this
// is a BadRequest (gitrpc maps it), never a silent empty diff.
var ErrFileNotInCommit = errors.New("gitsession: path is not one of this commit's changed files")

// ErrPathEscapesRoot is GoToTarget's own refusal for a path that resolves outside the repository
// root (gitrpc maps this to E_BAD_REQUEST) — the one place this phase resolves a path against a
// worktree root at all (F11), so it is also the one place that has to refuse an escaping one.
var ErrPathEscapesRoot = errors.New("gitsession: path escapes the repository root")

func repoWorkingDir(s gitclient.RepoSummary) string {
	if s.IsBare {
		return s.GitDir
	}
	return s.Root
}

// runOne runs one read-only git spawn through the repo's own read gate (e.Repo.Read — the same
// bounded pool every other read in this app goes through) and returns its raw stdout, classified
// through gitclient.Classify on a non-zero exit or spawn failure exactly like every other caller
// in this app.
func (e *RepoEntry) runOne(ctx context.Context, args []string) ([]byte, error) {
	var out []byte
	err := e.Repo.Read(ctx, func(ctx context.Context) error {
		res, rerr := gitclient.Run(ctx, e.Repo.Runner(), e.Repo.GitPath(), gitclient.Spec{
			Dir: repoWorkingDir(e.Summary), Args: args, ReadOnly: true,
		})
		if cerr := gitclient.Classify(ctx, args, res, rerr); cerr != nil {
			return cerr
		}
		out = res.Stdout
		return nil
	})
	return out, err
}

// runAllowingExit is runOne over the same read gate, but classifies through gitclient.Classify
// only when the resulting ExitCode is outside ok (D14/D15) — used by exactly three G5 callers,
// each with its own reason at the call site for which exit codes are ordinary outcomes rather
// than failures: merge-tree (0 or 1 — a conflict prediction is a successful prediction),
// `config --get-regexp` (0 or 1 — no matching config is the common case), and `rev-parse
// --verify` during undo capture (0 or 1 — a ref that has already vanished is a nil record, not an
// error).
func (e *RepoEntry) runAllowingExit(ctx context.Context, args []string, ok ...int) (gitclient.Result, error) {
	var res gitclient.Result
	err := e.Repo.Read(ctx, func(ctx context.Context) error {
		r, rerr := gitclient.Run(ctx, e.Repo.Runner(), e.Repo.GitPath(), gitclient.Spec{
			Dir: repoWorkingDir(e.Summary), Args: args, ReadOnly: true,
		})
		res = r
		if rerr != nil {
			return gitclient.Classify(ctx, args, r, rerr)
		}
		for _, code := range ok {
			if r.ExitCode == code {
				return nil
			}
		}
		return gitclient.Classify(ctx, args, r, nil)
	})
	return res, err
}

// oneRecord frames raw (a single `-z`-terminated record — every `show -s -z` spawn in this file
// produces exactly one) through RecordSplitter, same as the log walk's own framing, so a record
// this package hands to a parser never carries its own trailing NUL.
func oneRecord(raw []byte) ([]byte, error) {
	splitter := porcelain.NewRecordSplitter(0)
	recs, err := splitter.Push(raw)
	if err != nil {
		return nil, err
	}
	if flushed := splitter.Flush(); flushed != nil {
		return nil, fmt.Errorf("gitsession: unterminated trailing bytes: %q", flushed)
	}
	if len(recs) != 1 {
		return nil, fmt.Errorf("gitsession: got %d records, want exactly 1", len(recs))
	}
	return recs[0], nil
}

// allRecords frames raw through RecordSplitter and returns every complete record — the diff-tree
// spawns' own framing, which (unlike oneRecord) genuinely produces a variable number of records.
func allRecords(raw []byte) ([][]byte, error) {
	splitter := porcelain.NewRecordSplitter(0)
	recs, err := splitter.Push(raw)
	if err != nil {
		return nil, err
	}
	if flushed := splitter.Flush(); flushed != nil {
		return nil, fmt.Errorf("gitsession: unterminated trailing bytes: %q", flushed)
	}
	return recs, nil
}

// resolveFrom validates parentIndex against parents (a root commit has none, and is valid only at
// parentIndex 0 — its own diff is against the empty tree) and returns the argv-ready `from` a
// diff-tree spawn needs: nil selects --root.
func resolveFrom(parents []string, parentIndex int) (*string, error) {
	if len(parents) == 0 {
		if parentIndex != 0 {
			return nil, ErrParentIndexOutOfRange
		}
		return nil, nil
	}
	if parentIndex < 0 || parentIndex >= len(parents) {
		return nil, ErrParentIndexOutOfRange
	}
	p := parents[parentIndex]
	return &p, nil
}

// CommitDetail is commit.detail's own query (D8): the metadata `show` first (its parents are what
// the other two spawns diff from), then the body/signature `show` and the two diff-tree
// invocations concurrently — three of the repo's four read slots, the deliberate trade that keeps
// one detail request fast without letting five concurrent ones spawn fifteen processes (F14).
// Server-side cached (D7); dropped for this sha:parentIndex, or the whole cache, only on
// refsChanged (entry.go's note).
func (e *RepoEntry) CommitDetail(ctx context.Context, sha string, parentIndex int) (porcelain.CommitDetail, error) {
	if cached, ok := e.detail.get(sha, parentIndex); ok {
		return cached, nil
	}

	metaRaw, err := e.runOne(ctx, porcelain.ShowMetadataArgs(sha))
	if err != nil {
		return porcelain.CommitDetail{}, err
	}
	metaRec, err := oneRecord(metaRaw)
	if err != nil {
		return porcelain.CommitDetail{}, err
	}
	meta, err := porcelain.ParseLogRecord(metaRec)
	if err != nil {
		return porcelain.CommitDetail{}, err
	}

	from, err := resolveFrom(meta.Parents, parentIndex)
	if err != nil {
		return porcelain.CommitDetail{}, err
	}

	var (
		sig        porcelain.CommitSignature
		trailers   []porcelain.CommitTrailer
		body       string
		numstat    []porcelain.NumstatEntry
		nameStatus []porcelain.NameStatusEntry
		errs       [3]error
	)
	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		raw, rerr := e.runOne(ctx, porcelain.ShowBodyAndSignatureArgs(sha))
		if rerr != nil {
			errs[0] = rerr
			return
		}
		rec, rerr := oneRecord(raw)
		if rerr != nil {
			errs[0] = rerr
			return
		}
		sig, trailers, body, errs[0] = porcelain.ParseShowBodyAndSignature(rec)
	}()
	go func() {
		defer wg.Done()
		raw, rerr := e.runOne(ctx, porcelain.NumstatArgs(from, sha))
		if rerr != nil {
			errs[1] = rerr
			return
		}
		recs, rerr := allRecords(raw)
		if rerr != nil {
			errs[1] = rerr
			return
		}
		numstat, errs[1] = porcelain.ParseNumstatRecords(recs)
	}()
	go func() {
		defer wg.Done()
		raw, rerr := e.runOne(ctx, porcelain.NameStatusArgs(from, sha))
		if rerr != nil {
			errs[2] = rerr
			return
		}
		recs, rerr := allRecords(raw)
		if rerr != nil {
			errs[2] = rerr
			return
		}
		nameStatus, errs[2] = porcelain.ParseNameStatusRecords(recs)
	}()
	wg.Wait()
	for _, spawnErr := range errs {
		if spawnErr != nil {
			return porcelain.CommitDetail{}, spawnErr
		}
	}

	detail := porcelain.CommitDetail{
		SHA: meta.SHA, Parents: meta.Parents, Author: meta.Author, Committer: meta.Committer,
		Subject: meta.Subject, Body: body, Trailers: trailers, Signature: sig,
		Decoration: meta.Decoration, ParentIndex: parentIndex,
		Files: porcelain.CombineFileChanges(numstat, nameStatus),
	}
	e.detail.set(sha, parentIndex, detail)
	return detail, nil
}

// FileDiffResult is commit.fileDiff's own wire result — structurally matches @kira/git-ipc's
// 'commit.fileDiff' result field for field (D5, D6).
type FileDiffResult struct {
	SHA         string                 `json:"sha"`
	ParentIndex int                    `json:"parentIndex"`
	BaseSHA     *string                `json:"baseSha"` // no omitempty: null for a root commit, present either way
	Change      porcelain.FileChange   `json:"change"`
	Body        porcelain.FileDiffBody `json:"body"`

	// RawPatchBytes is the actual raw patch size the diff-tree spawn produced (or, on a cache hit,
	// the size recorded when it was first computed) — never marshaled (D2b): it exists only so
	// gitrpc's own encoded-result size guard can report the real patch size in a tooLarge body it
	// constructs after the fact, without re-running the spawn or re-deriving the number.
	RawPatchBytes int64 `json:"-"`
}

// FileDiff is commit.fileDiff's own query (D8, D12): resolves baseSha/change from CommitDetail
// (server-cached already, D7 — never a second `show`/`diff-tree` pair for fields commit.detail
// just computed), then the per-file patch itself, cached by <baseSha>:<sha>:<path> (D7) since two
// tree oids and a path determine it forever.
func (e *RepoEntry) FileDiff(ctx context.Context, sha, path, originalPath string, parentIndex int) (FileDiffResult, error) {
	detail, err := e.CommitDetail(ctx, sha, parentIndex)
	if err != nil {
		return FileDiffResult{}, err
	}

	var change *porcelain.FileChange
	for i := range detail.Files {
		if detail.Files[i].Path == path {
			change = &detail.Files[i]
			break
		}
	}
	if change == nil {
		return FileDiffResult{}, ErrFileNotInCommit
	}

	var baseSHA *string
	if len(detail.Parents) > 0 {
		p := detail.Parents[parentIndex]
		baseSHA = &p
	}
	baseKey := ""
	if baseSHA != nil {
		baseKey = *baseSHA
	}

	if body, rawBytes, ok := e.diff.get(baseKey, sha, path); ok {
		return FileDiffResult{
			SHA: sha, ParentIndex: parentIndex, BaseSHA: baseSHA, Change: *change,
			Body: body, RawPatchBytes: rawBytes,
		}, nil
	}

	var origPtr *string
	if change.OriginalPath != nil {
		origPtr = change.OriginalPath
	} else if originalPath != "" {
		origPtr = &originalPath
	}
	raw, err := e.runOne(ctx, porcelain.FileDiffArgs(baseSHA, sha, path, origPtr))
	if err != nil {
		return FileDiffResult{}, err
	}

	var body porcelain.FileDiffBody
	if int64(len(raw)) > MaxPatchBytes {
		body = porcelain.FileDiffBody{Kind: porcelain.BodyTooLarge, Bytes: int64(len(raw)), LimitBytes: MaxPatchBytes}
	} else {
		parsed, perr := porcelain.ParseFileDiffBody(raw)
		if perr != nil {
			return FileDiffResult{}, perr
		}
		body, err = e.resolveParsedBody(parsed)
		if err != nil {
			return FileDiffResult{}, err
		}
	}
	e.diff.set(baseKey, sha, path, body, int64(len(raw)))
	return FileDiffResult{
		SHA: sha, ParentIndex: parentIndex, BaseSHA: baseSHA, Change: *change,
		Body: body, RawPatchBytes: int64(len(raw)),
	}, nil
}

// resolveParsedBody turns porcelain's own narrower ParsedBody into the wire FileDiffBody — the
// one step porcelain itself cannot take (§3.2's own note): a binary arm's byte counts need a
// cat-file round trip, which is this package's job, not a pure parser's.
func (e *RepoEntry) resolveParsedBody(parsed porcelain.ParsedBody) (porcelain.FileDiffBody, error) {
	switch parsed.Kind {
	case porcelain.ParsedText:
		return porcelain.FileDiffBody{Kind: porcelain.BodyText, Hunks: parsed.Hunks}, nil
	case porcelain.ParsedEmpty:
		return porcelain.FileDiffBody{Kind: porcelain.BodyEmpty, Reason: parsed.EmptyReason}, nil
	case porcelain.ParsedLFSPointer:
		return porcelain.FileDiffBody{Kind: porcelain.BodyLFSPointer, OID: parsed.LFSOID, Bytes: parsed.LFSBytes}, nil
	case porcelain.ParsedBinary:
		oldBytes, err := e.blobSizeOrNil(parsed.OldOID)
		if err != nil {
			return porcelain.FileDiffBody{}, err
		}
		newBytes, err := e.blobSizeOrNil(parsed.NewOID)
		if err != nil {
			return porcelain.FileDiffBody{}, err
		}
		return porcelain.FileDiffBody{Kind: porcelain.BodyBinary, OldBytes: oldBytes, NewBytes: newBytes}, nil
	default:
		return porcelain.FileDiffBody{}, fmt.Errorf("gitsession: unexpected parsed body kind %q", parsed.Kind)
	}
}

// blobSizeOrNil looks up oid's size via --batch-check alone (never reading content) — nil, not an
// error, for a missing object: the all-zero oid a new or deleted binary file's pre/post image
// carries is exactly this case, and the wire's own oldBytes/newBytes are `undefined` for it.
func (e *RepoEntry) blobSizeOrNil(oid string) (*int64, error) {
	session := e.CatFile()
	if session == nil {
		return nil, ErrRepoTornDown
	}
	info, err := session.Check(oid)
	if err != nil {
		if errors.Is(err, catfile.ErrMissing) {
			return nil, nil
		}
		return nil, err
	}
	size := info.Size
	return &size, nil
}

// BlobResult is file.read's own wire result — structurally matches @kira/git-ipc's 'file.read'
// result union (D3).
type BlobResult struct {
	Kind       string `json:"kind"` // "found" | "missing" | "binary" | "tooLarge"
	Content    string `json:"content,omitempty"`
	Bytes      int64  `json:"bytes,omitempty"`
	LimitBytes int64  `json:"limitBytes,omitempty"`
}

// binarySniffWindow is the NUL-in-the-first-8-KiB binary sniff's own window (upstream's own rule,
// §3 probes).
const binarySniffWindow = 8192

func looksBinary(content []byte) bool {
	n := len(content)
	if n > binarySniffWindow {
		n = binarySniffWindow
	}
	return bytes.IndexByte(content[:n], 0) >= 0
}

// Blob is file.read's own query (D10): `<rev>:<path>` through the cat-file batch session, or
// (when path contains a newline, which the batch protocol cannot express at all) the one-shot
// fallback. Text only — a binary blob is refused rather than encoded, since the only consumer is a
// read-only text document (D3's own doc comment).
func (e *RepoEntry) Blob(ctx context.Context, rev, path string) (BlobResult, error) {
	full := rev + ":" + path
	session := e.CatFile()
	if session == nil {
		return BlobResult{}, ErrRepoTornDown
	}
	var info catfile.ObjectInfo
	var content []byte
	var err error
	// G31 round-2 architecture/security review, finding #2: this used to sniff only `path` for a
	// newline, not `rev` — but `full` (what actually crosses the batch protocol's stdin) is
	// `rev + ":" + path`, and the persistent cat-file session is one line in, one line out
	// (catfile/session.go). A newline anywhere in `full` — rev included, and rev is client-
	// supplied directly via file.read's own FileReadParams.Rev, validRefArg only rejects empty
	// and a leading "-" — makes git read it as TWO requests while only one response gets
	// consumed here; the leftover response line then answers the NEXT unrelated caller on this
	// same, connection-shared session, silently, for the life of the RepoEntry (readHeader still
	// parses a shifted header fine, so nothing errors and the circuit breaker never trips).
	// readCurrentContent, blobOID and blobOIDs (incremental.go) have the identical
	// `full`-vs-`path` gap, fixed the same way.
	if strings.ContainsRune(full, '\n') {
		info, content, err = session.ReadOneShot(ctx, full)
	} else {
		info, content, err = session.Read(full)
	}
	if err != nil {
		if errors.Is(err, catfile.ErrMissing) {
			return BlobResult{Kind: "missing"}, nil
		}
		if errors.Is(err, catfile.ErrTooLarge) {
			return BlobResult{Kind: "tooLarge", Bytes: info.Size, LimitBytes: catfile.DefaultMaxBlobBytes}, nil
		}
		return BlobResult{}, err
	}
	if looksBinary(content) {
		return BlobResult{Kind: "binary"}, nil
	}
	return BlobResult{Kind: "found", Content: string(content)}, nil
}

// GoToTarget is file.goToTarget's own wire result — structurally matches @kira/git-ipc's
// 'file.goToTarget' result union (D3, D4).
type GoToTarget struct {
	Kind    string `json:"kind"` // "live" | "historical" | "unavailable"
	AbsPath string `json:"absPath,omitempty"`
	// Hunks is D4's own drift-hunks handoff — deliberately NOT omitempty: the extension's own D11
	// wiring checks `hunks !== null` verbatim (an absent field and an explicit null are not
	// interchangeable there the way they are for every other optional field in this phase).
	// Meaningful only for "live"; present as null on every other arm too, which the webview never
	// reads.
	Hunks  []porcelain.DiffHunk `json:"hunks"`
	Rev    string               `json:"rev,omitempty"`
	Path   string               `json:"path,omitempty"`
	Reason string               `json:"reason,omitempty"` // unavailable: "notInRevision" | "binary" | "tooLarge"
}

// GoToTarget is "Go to file"'s own decision procedure (D4/D8's own pseudocode), in this order and
// no other: a bare repo has no checkout at all, so it always takes the historical branch; a path
// present on disk is live (re-mapped across drift by worktreeDiff, D4); otherwise the object
// database decides between historical and unavailable. It never consults HEAD, the index, or
// reachability — only "is there a file on disk" and "is there an object at <rev>:<path>".
func (e *RepoEntry) GoToTarget(ctx context.Context, rev, path string) (GoToTarget, error) {
	root := e.Summary.Root
	if e.Summary.IsBare || root == "" {
		return e.historicalOrUnavailable(ctx, rev, path)
	}

	abs := filepath.Join(root, path)
	rel, err := filepath.Rel(root, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return GoToTarget{}, ErrPathEscapesRoot
	}
	if _, statErr := os.Stat(abs); statErr == nil {
		hunks := e.worktreeDiff(ctx, rev, path)
		return GoToTarget{Kind: "live", AbsPath: abs, Hunks: hunks}, nil
	}
	return e.historicalOrUnavailable(ctx, rev, path)
}

// BlameLine is P5's own status-bar query: who last touched path's line in the working tree, right
// now — never a historical revision (no rev param; §0/§9 of the plan state why), never a cache (no
// stable key exists for a working-tree answer the way one exists for CommitDetail/FileDiff's
// immutable tree-oid keys). path is resolved against the repo root and rejected with
// ErrPathEscapesRoot on escape, the identical check GoToTarget already makes for the same reason (a
// blame request also resolves a path against a live worktree).
func (e *RepoEntry) BlameLine(ctx context.Context, path string, line int) (porcelain.BlameLine, error) {
	root := e.Summary.Root
	abs := filepath.Join(root, path)
	rel, err := filepath.Rel(root, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return porcelain.BlameLine{}, ErrPathEscapesRoot
	}
	raw, err := e.runOne(ctx, porcelain.BlameLineArgs(rel, line))
	if err != nil {
		return porcelain.BlameLine{}, err
	}
	return porcelain.ParseBlameLine(raw)
}

func (e *RepoEntry) historicalOrUnavailable(ctx context.Context, rev, path string) (GoToTarget, error) {
	blob, err := e.Blob(ctx, rev, path)
	if err != nil {
		return GoToTarget{}, err
	}
	switch blob.Kind {
	case "missing":
		return GoToTarget{Kind: "unavailable", Reason: "notInRevision"}, nil
	case "binary":
		return GoToTarget{Kind: "unavailable", Reason: "binary"}, nil
	case "tooLarge":
		return GoToTarget{Kind: "unavailable", Reason: "tooLarge"}, nil
	default: // "found"
		return GoToTarget{Kind: "historical", Rev: rev, Path: path}, nil
	}
}

// worktreeDiff is the drift re-map's own spawn (D4, D8) — deliberately uncached (D7: the answer
// changes on every keystroke in the user's own editor). It never errors: a refinement that cannot
// run (a failed spawn, a patch over MaxPatchBytes, a parse failure) must never turn a working "Go
// to file" into a failure, so every one of those answers nil hunks — the same "do not re-map"
// answer as an identical file or a real, on-disk deletion (HasDeletedPostImage, probe P6's own
// un-indexed-but-on-disk case).
func (e *RepoEntry) worktreeDiff(ctx context.Context, rev, path string) []porcelain.DiffHunk {
	raw, err := e.runOne(ctx, porcelain.WorktreeDiffArgs(rev, path))
	if err != nil || len(raw) == 0 || int64(len(raw)) > MaxPatchBytes {
		return nil
	}
	if porcelain.HasDeletedPostImage(raw) {
		return nil
	}
	parsed, err := porcelain.ParseFileDiffBody(raw)
	if err != nil || parsed.Kind != porcelain.ParsedText {
		return nil
	}
	return parsed.Hunks
}
