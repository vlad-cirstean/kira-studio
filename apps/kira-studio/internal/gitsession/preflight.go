package gitsession

import (
	"context"
	"fmt"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// rewrittenPaths reads T — the paths target's checkout would rewrite (gitops.RewrittenPathsArgs).
func (e *RepoEntry) rewrittenPaths(ctx context.Context, target string) ([]string, error) {
	raw, err := e.runOne(ctx, gitops.RewrittenPathsArgs(target))
	if err != nil {
		return nil, err
	}
	recs, err := allRecords(raw)
	if err != nil {
		return nil, err
	}
	out := make([]string, len(recs))
	for i, r := range recs {
		out[i] = string(r)
	}
	return out, nil
}

// PreflightCheckout is preflight.checkout's own orchestration (D12): gather the reads in
// parallel, resolve the wire's bare target against a FRESH ref snapshot (never the cache, D10/
// F16), call the pure classifier. StashAvailable is false through G8 (D12) — G12's own phase
// flips it.
func (e *RepoEntry) PreflightCheckout(ctx context.Context, target, mode string) (gitpreflight.CheckoutPreflight, error) {
	snapshot, err := e.refsSnapshot(ctx)
	if err != nil {
		return gitpreflight.CheckoutPreflight{}, err
	}
	resolved := resolveCheckoutTarget(snapshot, target)

	var statusResult porcelain.StatusResult
	var inProgress *gitpreflight.InProgressOperation
	var rewritten []string
	var statusErr, rewrittenErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		statusResult, inProgress, statusErr = e.statusAndInProgress(ctx)
	}()
	go func() {
		defer wg.Done()
		rewritten, rewrittenErr = e.rewrittenPaths(ctx, resolved.Name)
	}()
	wg.Wait()
	if statusErr != nil {
		return gitpreflight.CheckoutPreflight{}, statusErr
	}
	if rewrittenErr != nil {
		return gitpreflight.CheckoutPreflight{}, rewrittenErr
	}

	return gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target:       gitpreflight.CheckoutTarget{Kind: resolved.Kind, Name: resolved.Name},
		Mode:         mode,
		Dirty:        gitpreflight.DirtyPaths(statusResult),
		Rewritten:    rewritten,
		InProgress:   inProgress,
		CheckedOutIn: resolved.CheckedOutIn,
	}), nil
}

// revertMergeParents looks up, for every MERGE commit among shas, its parents' shas and subjects
// (D13): one `show -s` per requested sha to learn its parent count/shas, then one more per
// DISTINCT parent sha across every merge found (deduplicated) to learn that parent's subject.
// Sequential, not concurrent (F18's deviation from upstream's own Promise.all): the read pool is
// four wide and shared with every other connection on the repository, so a large multi-select
// revert firing dozens of concurrent reads would starve the graph stream of another window.
func (e *RepoEntry) revertMergeParents(ctx context.Context, shas []string) (map[string][]gitpreflight.RevertParentChoice, error) {
	type meta struct {
		sha     string
		parents []string
	}
	metas := make([]meta, 0, len(shas))
	for _, sha := range shas {
		raw, err := e.runOne(ctx, porcelain.ShowMetadataArgs(sha))
		if err != nil {
			return nil, err
		}
		rec, err := oneRecord(raw)
		if err != nil {
			return nil, err
		}
		parsed, err := porcelain.ParseLogRecord(rec)
		if err != nil {
			return nil, err
		}
		metas = append(metas, meta{sha: sha, parents: parsed.Parents})
	}

	subjects := make(map[string]string)
	var parentOrder []string
	for _, m := range metas {
		if len(m.parents) <= 1 {
			continue
		}
		for _, p := range m.parents {
			if _, ok := subjects[p]; !ok {
				subjects[p] = ""
				parentOrder = append(parentOrder, p)
			}
		}
	}
	for _, p := range parentOrder {
		raw, err := e.runOne(ctx, porcelain.ShowMetadataArgs(p))
		if err != nil {
			return nil, err
		}
		rec, err := oneRecord(raw)
		if err != nil {
			return nil, err
		}
		parsed, err := porcelain.ParseLogRecord(rec)
		if err != nil {
			return nil, err
		}
		subjects[p] = parsed.Subject
	}

	result := make(map[string][]gitpreflight.RevertParentChoice)
	for _, m := range metas {
		if len(m.parents) <= 1 {
			continue
		}
		choices := make([]gitpreflight.RevertParentChoice, len(m.parents))
		for i, p := range m.parents {
			choices[i] = gitpreflight.RevertParentChoice{ParentNumber: i + 1, Sha: p, Subject: subjects[p]}
		}
		result[m.sha] = choices
	}
	return result, nil
}

// predictRevert runs D13's own merge-tree prediction for firstSha, scoped exactly to shas[0]
// (predictedFor says so). A merge commit with no mainline chosen yet gets {kind:"unknown"} rather
// than a guess (§7.10's "rather than guessing -m 1"); exit 0/1 are both real predictions (D14/D15),
// gated by runAllowingExit rather than gitclient.Classify.
func (e *RepoEntry) predictRevert(
	ctx context.Context, firstSha string, mergeParents map[string][]gitpreflight.RevertParentChoice, mainline *int,
) gitpreflight.RevertPrediction {
	if firstSha == "" {
		return gitpreflight.RevertPrediction{Kind: "unknown", Reason: "no commit selected"}
	}
	_, isMerge := mergeParents[firstSha]
	if isMerge && mainline == nil {
		return gitpreflight.RevertPrediction{
			Kind: "unknown", Reason: "a mainline parent must be chosen before predicting this merge commit's revert",
		}
	}
	effectiveMainline := 1
	if isMerge {
		effectiveMainline = *mainline
	}
	other := fmt.Sprintf("%s^%d", firstSha, effectiveMainline)

	res, err := e.runAllowingExit(ctx, porcelain.MergeTreeArgs("HEAD", other, firstSha), 0, 1)
	if err != nil {
		return gitpreflight.RevertPrediction{Kind: "unknown", Reason: err.Error()}
	}
	pred, err := porcelain.ParseMergeTreeOutput(res.Stdout, res.ExitCode)
	if err != nil {
		return gitpreflight.RevertPrediction{Kind: "unknown", Reason: err.Error()}
	}
	if pred.Kind == "clean" {
		return gitpreflight.RevertPrediction{Kind: "clean"}
	}
	return gitpreflight.RevertPrediction{Kind: "conflicts", Paths: pred.Paths}
}

// PreflightRevert is preflight.revert's own orchestration (D13): status/in-progress and the
// merge-parent lookups run in parallel; the prediction and the classification both follow.
func (e *RepoEntry) PreflightRevert(ctx context.Context, shas []string, mainline *int) (gitpreflight.RevertPreflight, error) {
	var statusResult porcelain.StatusResult
	var inProgress *gitpreflight.InProgressOperation
	var mergeParents map[string][]gitpreflight.RevertParentChoice
	var statusErr, mergeErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		statusResult, inProgress, statusErr = e.statusAndInProgress(ctx)
	}()
	go func() {
		defer wg.Done()
		mergeParents, mergeErr = e.revertMergeParents(ctx, shas)
	}()
	wg.Wait()
	if statusErr != nil {
		return gitpreflight.RevertPreflight{}, statusErr
	}
	if mergeErr != nil {
		return gitpreflight.RevertPreflight{}, mergeErr
	}

	var firstSha string
	if len(shas) > 0 {
		firstSha = shas[0]
	}
	prediction := e.predictRevert(ctx, firstSha, mergeParents, mainline)

	dirty := gitpreflight.DirtyPaths(statusResult)
	dirtyPaths := make([]string, len(dirty))
	for i, d := range dirty {
		dirtyPaths[i] = d.Path
	}

	head := headStateFromStatusBranch(statusResult.Branch)

	return gitpreflight.ClassifyRevert(gitpreflight.ClassifyRevertInput{
		Shas: shas, MergeParents: mergeParents, Mainline: mainline,
		DirtyPaths: dirtyPaths, InProgress: inProgress,
		DetachedHead: head.Kind == "detached",
		Prediction:   prediction,
	}), nil
}
