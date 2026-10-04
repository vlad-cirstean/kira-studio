package gitsession

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitops"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
)

// queuefacts.go is P129 Part 2 §3's own thin-wrapper seam: every git read internal/ade's facts
// engine needs, so `ade` never builds git argv itself and every read goes through this entry's own
// runner, read pool and caches (runOne/runAllowingExit/fileChanges/mergeBase, all queries.go/
// incremental.go's own unexported machinery, reused rather than duplicated). No new signature on any
// existing exported method — additions only.

// BranchInventory is queue Snapshot's own first read: every local and remote-tracking branch,
// newest commit first (porcelain.InventoryArgs/ParseInventory).
func (e *RepoEntry) BranchInventory(ctx context.Context) ([]porcelain.InventoryRef, error) {
	raw, err := e.runOne(ctx, porcelain.InventoryArgs())
	if err != nil {
		return nil, err
	}
	return porcelain.ParseInventory(raw)
}

// MainRef is §0.6's own rule: origin/HEAD's target when it resolves to a ref that exists, else the
// first of the repo's own ReviewBaseCandidates that resolves — tried as `<defaultRemote>/<c>` then
// local `<c>` — else ok=false ("noMain": branches then carry meta only). Reuses review.go's own
// originHead/findBranchRef and the same DefaultBaseCandidates fallback ResolveReviewBase already
// applies when the repo has no stored candidates.
func (e *RepoEntry) MainRef(ctx context.Context) (ref, tip string, ok bool, err error) {
	snapshot, err := e.Refs(ctx)
	if err != nil {
		return "", "", false, err
	}
	oh, err := e.originHead(ctx)
	if err != nil {
		return "", "", false, err
	}
	if oh != "" {
		if r, found := findBranchRef(snapshot, oh); found {
			return r.Refname, r.ObjectID, true, nil
		}
	}

	candidates := e.RepoSettings().ReviewBaseCandidates
	if len(candidates) == 0 {
		candidates = gitreview.DefaultBaseCandidates
	}
	remote, hasRemote := e.pickAutoFetchRemote(ctx)
	for _, c := range candidates {
		if hasRemote {
			if r, found := findBranchRef(snapshot, remote+"/"+c); found {
				return r.Refname, r.ObjectID, true, nil
			}
		}
		if r, found := findBranchRef(snapshot, c); found {
			return r.Refname, r.ObjectID, true, nil
		}
	}
	return "", "", false, nil
}

// DefaultRemote is D23's own pickAutoFetchRemote rule (autofetch.go), exported under the name the
// queue facts engine calls it by — "origin" if present, else the sole remote, else false.
func (e *RepoEntry) DefaultRemote(ctx context.Context) (string, bool) {
	return e.pickAutoFetchRemote(ctx)
}

// AheadBehind is `rev-list --left-right --count <left>...<right>` (gitops.AheadBehindArgs):
// commits reachable only from left ("ahead"), only from right ("behind").
func (e *RepoEntry) AheadBehind(ctx context.Context, left, right string) (ahead, behind int, err error) {
	out, err := e.runOne(ctx, gitops.AheadBehindArgs(left, right))
	if err != nil {
		return 0, 0, err
	}
	return porcelain.ParseLeftRightCount(out)
}

// RangeChanges is a branch's own file changes since it diverged from base: the merge base of
// (base, tip), then numstat/name-status from there to tip, combined — a PR-shaped diff, not a
// literal two-dot `base..tip` (which would include base's own unrelated later history too when the
// two have diverged in both directions). No merge base at all (unrelated histories): diffs against
// base directly rather than failing outright — the same "always return something" spirit §0.7's
// merge-tree fallback follows for the conflict side of this same problem.
func (e *RepoEntry) RangeChanges(ctx context.Context, base, tip string) ([]porcelain.FileChange, error) {
	from := base
	if sha, ok, err := e.mergeBase(ctx, base, tip); err != nil {
		return nil, err
	} else if ok {
		from = sha
	}
	numstat, nameStatus, err := e.fileChanges(ctx, porcelain.NumstatArgs(&from, tip), porcelain.NameStatusArgs(&from, tip))
	if err != nil {
		return nil, err
	}
	return porcelain.CombineFileChanges(numstat, nameStatus), nil
}

// RangeCommits is `log --format=%H%x1f%s -z -N base..tip` (porcelain.RangeSubjectsArgs/
// ParseRangeSubjects), newest first, capped at limit. The full count comes from AheadBehind
// separately (§4.2's own commitCount = ahead) — this wrapper drops ParseRangeSubjects' own
// truncated flag rather than serving a second, redundant count.
func (e *RepoEntry) RangeCommits(ctx context.Context, base, tip string, limit int) ([]porcelain.RangeCommit, error) {
	raw, err := e.runOne(ctx, porcelain.RangeSubjectsArgs(base, tip, limit))
	if err != nil {
		return nil, err
	}
	commits, _, err := porcelain.ParseRangeSubjects(raw, limit)
	if err != nil {
		return nil, err
	}
	return commits, nil
}

// Ancestors reports which of among (a set of refnames) are ancestors of tip — `for-each-ref
// --merged=<tip> <among...>`, inferParents' own ancestry input (§0.5).
func (e *RepoEntry) Ancestors(ctx context.Context, tip string, among []string) ([]string, error) {
	if len(among) == 0 {
		return nil, nil
	}
	args := append([]string{"for-each-ref", "--format=%(refname)", "--merged=" + tip}, among...)
	raw, err := e.runOne(ctx, args)
	if err != nil {
		return nil, err
	}
	text := strings.TrimSuffix(string(raw), "\n")
	if text == "" {
		return nil, nil
	}
	return strings.Split(text, "\n"), nil
}

// MergeTreeConflicts is §0.1's own in-memory three-way merge prediction: the merge base of (a, b),
// then `merge-tree --write-tree --messages --name-only -z --merge-base=<base> a b`, tolerating exit
// 0 (clean) or 1 (conflicts) as ordinary outcomes (D14, same as every other runAllowingExit caller
// in this package). No merge base (unrelated histories, §0.1/§0.7): a clean prediction with no
// paths, never an error — merge-tree itself would otherwise pick its own (misleading) base.
func (e *RepoEntry) MergeTreeConflicts(ctx context.Context, a, b string) (porcelain.MergePrediction, error) {
	base, ok, err := e.mergeBase(ctx, a, b)
	if err != nil {
		return porcelain.MergePrediction{}, err
	}
	if !ok {
		return porcelain.MergePrediction{Kind: "clean"}, nil
	}
	res, err := e.runAllowingExit(ctx, porcelain.MergeTreeArgs(a, b, base), 0, 1)
	if err != nil {
		return porcelain.MergePrediction{}, err
	}
	return porcelain.ParseMergeTreeOutput(res.Stdout, res.ExitCode)
}

// WorktreeStatus is a linked (or the main) worktree's own dirty entries — worktreeIsDirty's own
// spawn (runOneInDir/StatusArgs), parsed in full rather than reduced to a bool.
func (e *RepoEntry) WorktreeStatus(ctx context.Context, dir string) ([]porcelain.StatusEntry, error) {
	raw, err := e.runOneInDir(ctx, dir, porcelain.StatusArgs())
	if err != nil {
		return nil, err
	}
	recs, err := allRecords(raw)
	if err != nil {
		return nil, err
	}
	result, err := porcelain.ParseStatus(recs)
	if err != nil {
		return nil, err
	}
	return result.Entries, nil
}

// ReflogCreatedAt is §0.10's own new-work rebind heuristic input: refs/heads/<branch>'s own reflog,
// oldest entry (git prints newest first, so the LAST line), as a unix second. ok=false for a branch
// with no reflog history to read (never existed, or reflog is disabled) — tolerated via
// runAllowingExit(0,128), the "ref does not exist" precedent every other bad-ref read in this
// package already follows.
func (e *RepoEntry) ReflogCreatedAt(ctx context.Context, branch string) (int64, bool, error) {
	res, err := e.runAllowingExit(ctx, []string{"reflog", "show", "--format=%ct", "refs/heads/" + branch}, 0, 128)
	if err != nil {
		return 0, false, err
	}
	if res.ExitCode != 0 {
		return 0, false, nil
	}
	trimmed := strings.TrimSpace(string(res.Stdout))
	if trimmed == "" {
		return 0, false, nil
	}
	lines := strings.Split(trimmed, "\n")
	last := lines[len(lines)-1]
	unix, err := strconv.ParseInt(last, 10, 64)
	if err != nil {
		return 0, false, fmt.Errorf("gitsession: parse reflog created-at for %s: %w", branch, err)
	}
	return unix, true, nil
}

// ConfigValue is a plain `git config --get <key>` read (§0.11's own `user.email` lookup) —
// tolerated via runAllowingExit(0,1), CoreAskPassArgs' own precedent for "no such config is the
// common case".
func (e *RepoEntry) ConfigValue(ctx context.Context, key string) (string, error) {
	res, err := e.runAllowingExit(ctx, []string{"config", "--get", key}, 0, 1)
	if err != nil {
		return "", err
	}
	if res.ExitCode != 0 {
		return "", nil
	}
	return strings.TrimSpace(string(res.Stdout)), nil
}

// StackParents is inferParents' own config input (§0.5 rule 1): branch -> its recorded
// `branch.<b>.kirastackparent`, empty parents dropped — rawStackConfig's own read, reduced to just
// the parent name Stacks' own richer StackListResult would otherwise require a second, unrelated
// refs read to assemble.
func (e *RepoEntry) StackParents(ctx context.Context) (map[string]string, error) {
	config, err := e.rawStackConfig(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(config))
	for branch, entry := range config {
		if entry.Parent != "" {
			out[branch] = entry.Parent
		}
	}
	return out, nil
}

// IsAncestor reports whether a is reachable from b (`merge-base --is-ancestor`); an unresolvable
// ref reads as false.
func (e *RepoEntry) IsAncestor(ctx context.Context, a, b string) (bool, error) {
	return e.isAncestorOrNot(ctx, a, b)
}

// CountRange counts the commits reachable from tip but not from base.
func (e *RepoEntry) CountRange(ctx context.Context, base, tip string) (int, error) {
	return e.countRange(ctx, base, tip)
}

// Cherry runs `git cherry <upstream> <head> <limit>` and returns how many commits of head have no
// equivalent patch in upstream (plus) and how many do (minus). Commits reachable from upstream are
// not listed at all.
func (e *RepoEntry) Cherry(ctx context.Context, upstream, head, limit string) (plus, minus int, err error) {
	out, err := e.runOne(ctx, porcelain.CherryArgs(upstream, head, limit))
	if err != nil {
		return 0, 0, err
	}
	plus, minus = porcelain.ParseCherry(out)
	return plus, minus, nil
}

// DiffPatchID is the patch id of the PR-shaped diff base...tip ("" when that diff is empty).
func (e *RepoEntry) DiffPatchID(ctx context.Context, base, tip string) (string, error) {
	ids, err := e.pipePatchID(ctx, porcelain.ThreeDotDiffArgs(base, tip))
	if err != nil || len(ids) == 0 {
		return "", err
	}
	return ids[0], nil
}

// RecentPatchIDs returns the patch ids of the last n non-merge commits reachable from ref.
func (e *RepoEntry) RecentPatchIDs(ctx context.Context, ref string, n int) ([]string, error) {
	return e.pipePatchID(ctx, porcelain.LogPatchArgs(ref, n))
}

// pipePatchID streams a patch-producing read into `git patch-id --stable` and returns its ids.
// Read-only: neither process touches the worktree, the index, HEAD or any ref.
func (e *RepoEntry) pipePatchID(ctx context.Context, producer []string) ([]string, error) {
	var ids []string
	err := e.Repo.Read(ctx, func(ctx context.Context) error {
		runner, gitPath, dir := e.Repo.Runner(), e.Repo.GitPath(), repoWorkingDir(e.Summary)
		src, err := runner.Start(ctx, gitPath, gitclient.Spec{Dir: dir, Args: producer, ReadOnly: true})
		if err != nil {
			return err
		}
		defer src.Close() //nolint:errcheck
		sink, err := runner.Start(ctx, gitPath, gitclient.Spec{Dir: dir, Args: porcelain.PatchIDArgs(), ReadOnly: true, Stdin: true})
		if err != nil {
			return err
		}
		defer sink.Close() //nolint:errcheck
		go func() {
			_, _ = io.Copy(sink.Stdin(), src.Stdout())
			_ = sink.Stdin().Close()
		}()
		out, rerr := io.ReadAll(sink.Stdout())
		sinkRes, werr := sink.Wait()
		if rerr != nil {
			return rerr
		}
		if werr != nil {
			return werr
		}
		if cerr := gitclient.Classify(ctx, porcelain.PatchIDArgs(), sinkRes, nil); cerr != nil {
			return cerr
		}
		srcRes, werr := src.Wait()
		if werr != nil {
			return werr
		}
		if cerr := gitclient.Classify(ctx, producer, srcRes, nil); cerr != nil {
			return cerr
		}
		ids = porcelain.ParsePatchIDs(out)
		return nil
	})
	return ids, err
}
