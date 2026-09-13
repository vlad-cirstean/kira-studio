package gitsearch

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// Deps is what Scan needs to spawn one process — logsession.Deps's own shape, minus the Read
// gate: D12's caller (gitsession's (*Walk).Search) runs Scan itself inside entry.Repo.Read, so a
// second, nested gate here would be redundant and layered wrong.
type Deps struct {
	Runner  gitclient.Runner
	GitPath string
	Dir     string
}

// Options configures one Scan call.
type Options struct {
	// Args is the full argv — porcelain.LogScanArgs(spec)'s own output, never a user pattern
	// (D0's own ground rule: the pattern never reaches git).
	Args []string
	// Matcher is Compile's own result. Must not be nil.
	Matcher *Matcher
	// Limit caps how many Hits are collected; <= 0 -> DefaultLimit. Total keeps counting past it.
	Limit int
	// Budget bounds the scan's own wall-clock time; <= 0 -> DefaultScanBudget.
	Budget time.Duration
}

// Hit is one matched commit — the Go-side twin of @kira/git-ipc's own CommitSearchHit.
type Hit struct {
	SHA         string
	Subject     string
	AuthorName  string
	AuthorEmail string
	AuthorTime  int64
	Fields      []Field
}

// Result is one Scan call's outcome — the Go-side twin of SearchRunResult's 'ok' member.
type Result struct {
	// Hits is walk order (upstream probe 11), capped at Limit.
	Hits []Hit
	// Total is EXACT, counted over every commit scanned — never just len(Hits) (D11: the scan
	// runs to git's own end regardless of Limit, so this stays exact even once Hits is full).
	Total int
	// Truncated is Total > len(Hits).
	Truncated bool
	Scanned   int
	// Complete is false when the host-side time box fired before git's own end.
	Complete bool
}

// DefaultScanBudget is upstream's own SEARCH_SCAN_BUDGET_MS. Checked every 1024 scanned records.
//
// One Go-specific note: RE2 has no backtracking and is linear in input, so upstream's own
// probe-10 catastrophic-backtracking hazard (a pathological pattern taking 853ms against a
// 31-character string in JS) cannot occur on this side at all — this budget guards against a very
// large repository, never against a pathological pattern.
const DefaultScanBudget = 5 * time.Second

// DefaultLimit is upstream's own DEFAULT_SEARCH_LIMIT — 200 tail hits.
const DefaultLimit = 200

const scanReadChunkSize = 64 * 1024

// Scan runs one streaming, cancellable, time-boxed tail scan: Runner.Start -> a 64 KiB read loop
// (cancellable exactly like logsession.readChunkLocked) -> porcelain.RecordSplitter.Push ->
// porcelain.ParseScanRecord -> Matcher.MatchFields — the same three spawn/split/classify pieces
// logsession already composes, built fresh rather than reused (F9: a paused logsession cannot be
// read from without consuming the paging walk's own records, and its argv differs anyway).
//
// Never buffers the whole of stdout (unlike gitclient.Run): upstream probe 5b measured the scan's
// own output at ~20 MB over 100k commits, and the matcher is a streaming fold that has no reason
// to hold all of it in memory at once.
func Scan(ctx context.Context, deps Deps, opts Options) (Result, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = DefaultLimit
	}
	budget := opts.Budget
	if budget <= 0 {
		budget = DefaultScanBudget
	}

	proc, err := deps.Runner.Start(ctx, deps.GitPath, gitclient.Spec{Dir: deps.Dir, Args: opts.Args, ReadOnly: true})
	if err != nil {
		return Result{}, err
	}

	result := Result{Complete: true}
	splitter := porcelain.NewRecordSplitter(0)
	deadline := time.Now().Add(budget)

	for {
		chunk, readErr := readScanChunk(ctx, proc)
		if len(chunk) > 0 {
			recs, splitErr := splitter.Push(chunk)
			if splitErr != nil {
				_ = proc.Close()
				return Result{}, splitErr
			}
			for _, rec := range recs {
				result.Scanned++
				cr, perr := porcelain.ParseScanRecord(rec)
				if perr != nil {
					_ = proc.Close()
					return Result{}, perr
				}
				fields := opts.Matcher.MatchFields(CommitFields{
					SHA: cr.SHA, Subject: cr.Subject, Body: cr.Body,
					AuthorName: cr.Author.Name, AuthorEmail: cr.Author.Email,
					CommitterName: cr.Committer.Name, CommitterEmail: cr.Committer.Email,
				})
				if len(fields) > 0 {
					result.Total++
					if len(result.Hits) < limit {
						result.Hits = append(result.Hits, Hit{
							SHA: cr.SHA, Subject: cr.Subject,
							AuthorName: cr.Author.Name, AuthorEmail: cr.Author.Email,
							AuthorTime: cr.Author.Timestamp, Fields: fields,
						})
					}
				}
				// Every 1024 records — a power-of-two boundary so the check itself is not the
				// cost — test the deadline. The scan still stops running rather than continuing
				// to git's own end: unlike the exact-Total-past-Limit rule, a time-boxed scan
				// genuinely has not seen the rest of the walk.
				if result.Scanned%1024 == 0 && time.Now().After(deadline) {
					result.Complete = false
					result.Truncated = result.Total > len(result.Hits)
					_ = proc.Close()
					return result, nil
				}
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				break
			}
			if ctx.Err() != nil {
				// A caller cancellation (supersede, or the connection tearing down) — classified
				// the same way every other read in this app is (gitclient.Classify), so a
				// generic error-mapping layer sees the same Cancelled kind regardless of which
				// package produced it. readScanChunk has already killed the child.
				return Result{}, gitclient.Classify(ctx, opts.Args, gitclient.Result{}, readErr)
			}
			_ = proc.Close()
			return Result{}, readErr
		}
	}

	if flushed := splitter.Flush(); len(flushed) > 0 {
		_ = proc.Close()
		return Result{}, fmt.Errorf("gitsearch: unterminated trailing record at EOF (%d bytes)", len(flushed))
	}
	res, waitErr := proc.Wait()
	if cerr := gitclient.Classify(ctx, opts.Args, res, waitErr); cerr != nil {
		return Result{}, cerr
	}
	result.Truncated = result.Total > len(result.Hits)
	return result, nil
}

// readScanChunk reads one raw chunk off proc's stdout, cancellable by ctx — mirrors
// logsession.readChunkLocked exactly: a cancelled ctx kills the child (Process.Close) and returns
// promptly rather than leaving the read (and the caller) blocked indefinitely.
func readScanChunk(ctx context.Context, proc gitclient.Process) ([]byte, error) {
	type readResult struct {
		b   []byte
		err error
	}
	stdout := proc.Stdout()
	ch := make(chan readResult, 1)
	go func() {
		buf := make([]byte, scanReadChunkSize)
		n, err := stdout.Read(buf)
		ch <- readResult{b: buf[:n], err: err}
	}()
	select {
	case r := <-ch:
		return r.b, r.err
	case <-ctx.Done():
		_ = proc.Close()
		return nil, ctx.Err()
	}
}
