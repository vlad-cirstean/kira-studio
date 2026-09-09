package gitsession

import (
	"context"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsearch"
)

// Search is search.run's server half (G23 D12): gitsearch.Scan over THIS walk's own rev set —
// w.spec, not a fresh default — so every hit is a row the graph can actually reveal, and probe
// 11's ordering-identity property holds between a loaded page and a scan.
//
// Runs inside entry.Repo.Read: a bounded one-shot read belongs in the four-slot reader pool like
// every other read — NOT logsession's direct-spawn exception, which exists because a PAUSED
// process would hold a slot forever; a scan terminates on its own (§10.7).
//
// One in-flight scan per walk: a new call cancels the previous one before spawning its own, as
// the host-side belt to the client's own abort-on-supersede brace (F8). searchGen (not a plain
// nil-check on searchCancel) is what lets this call's own cleanup tell "I am still the current
// scan" apart from "a newer call already superseded me and installed its own cancel" — without
// it, an older call's deferred cleanup could nil out a NEWER call's still-live searchCancel,
// leaving two scans able to run concurrently against the same walk.
func (w *Walk) Search(ctx context.Context, q gitsearch.Query, limit int) (gitsearch.Result, error) {
	matcher, err := gitsearch.Compile(q)
	if err != nil {
		return gitsearch.Result{}, err
	}

	w.mu.Lock()
	w.ensureFreshLocked()
	spec := w.spec
	if w.searchCancel != nil {
		w.searchCancel()
	}
	scanCtx, cancel := context.WithCancel(ctx)
	w.searchGen++
	myGen := w.searchGen
	w.searchCancel = cancel
	repo := w.entry.Repo
	gitPath := w.gitPath
	dir := walkDir(w.entry.Summary)
	w.mu.Unlock()

	defer func() {
		cancel()
		w.mu.Lock()
		if w.searchGen == myGen {
			w.searchCancel = nil
		}
		w.mu.Unlock()
	}()

	deps := gitsearch.Deps{Runner: repo.Runner(), GitPath: gitPath, Dir: dir}
	var result gitsearch.Result
	err = repo.Read(scanCtx, func(readCtx context.Context) error {
		res, serr := gitsearch.Scan(readCtx, deps, gitsearch.Options{
			Args:    porcelain.LogScanArgs(spec),
			Matcher: matcher,
			Limit:   limit,
		})
		result = res
		return serr
	})
	return result, err
}
