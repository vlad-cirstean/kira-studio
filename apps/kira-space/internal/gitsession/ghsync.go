package gitsession

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ghclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/catfile"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
)

// ghsync.go: the one-way app -> GitHub "viewed" sync plan (P150). The rules live in ghSyncDecision.

// GhSyncFile is one row of a sync plan: Action is "mark" | "unmark" | "alreadyViewed" | "skip",
// Reason names why a file is skipped.
type GhSyncFile struct {
	Path   string
	Action string
	Reason string
}

// GhSyncPlanResult is GhSyncPlan's outcome. Status is "ok" | "disabled" | "ghMissing" |
// "unauthenticated" | "unavailable" | "prClosed" | "headNotFetched". Files, DropSynced and PrNodeID
// are set only for "ok". DropSynced lists ledger rows to delete without a GitHub call.
type GhSyncPlanResult struct {
	Status     string
	Message    string
	Account    string
	HeadSha    string
	LocalTip   string
	PrNodeID   string
	Files      []GhSyncFile
	DropSynced []string
}

// ghSyncFacts is everything the decision for one path needs.
type ghSyncFacts struct {
	InPr, PrViewed bool
	Synced         bool   // this app marked it on GitHub
	Kind           string // review kind: "none" | "partial" | "full"
	Changed        bool   // local tip blob differs from the reviewed blob
	RecordOID      string
	PrOID          string // blob oid at the PR head
}

// ghSyncDecision applies the rules in order; action "" omits the path from the plan.
func ghSyncDecision(f ghSyncFacts) (action, reason string, dropSynced bool) {
	switch {
	case !f.InPr:
		if f.Kind != "none" {
			return "skip", "notInPr", f.Synced
		}
		return "", "", f.Synced
	case f.Synced && f.Kind != "full":
		if f.PrViewed {
			return "unmark", "", false
		}
		return "", "", true
	case f.Kind == "none":
		return "skip", "notReviewed", false
	case f.Kind == "partial":
		return "skip", "partial", false
	case f.Changed:
		return "skip", "changedSinceReview", false
	case f.PrOID != f.RecordOID:
		return "skip", "differsFromPrHead", false
	case f.PrViewed:
		return "alreadyViewed", "", false
	}
	return "mark", "", false
}

// GhStatusKind maps a failed gh status to a GhSyncStatus.
func GhStatusKind(s ghclient.Status) string {
	switch s.Kind {
	case ghclient.KindNotFound:
		return "ghMissing"
	case ghclient.KindUnauthenticated:
		return "unauthenticated"
	}
	return "unavailable"
}

func (e *RepoEntry) ghSyncPrefix(ctx context.Context) (ghclient.Repo, *GhSyncPlanResult) {
	if !e.githubEnabled() {
		return ghclient.Repo{}, &GhSyncPlanResult{Status: "disabled", Message: "GitHub is turned off for this repo"}
	}
	repo, ok := e.githubRepo(ctx)
	if !ok {
		return ghclient.Repo{}, &GhSyncPlanResult{Status: "disabled", Message: "This repo has no GitHub remote"}
	}
	if status, armed := e.gh.breakerStatus(); armed {
		return repo, &GhSyncPlanResult{Status: "unavailable", Message: status.Reason}
	}
	return repo, nil
}

func (e *RepoEntry) ghFailure(status ghclient.Status) *GhSyncPlanResult {
	if isRateLimitedStatus(status) {
		e.gh.armBreaker(status)
	}
	return &GhSyncPlanResult{Status: GhStatusKind(status), Message: status.Reason}
}

// GhSyncPlan computes what a sync of branch (against base) to PR #pr would do. synced holds the
// paths this app marked earlier. A non-nil error is a local failure (git, review.db).
func (e *RepoEntry) GhSyncPlan(ctx context.Context, branch, base string, pr int, synced map[string]bool) (GhSyncPlanResult, error) {
	repo, early := e.ghSyncPrefix(ctx)
	if early != nil {
		return *early, nil
	}
	account := e.ghClient.Account(ctx, repo.Host)
	files, status := e.ghClient.PullFiles(ctx, repo, pr)
	if !status.OK() {
		res := e.ghFailure(status)
		res.Account = account
		return *res, nil
	}
	if files.State != "OPEN" {
		return GhSyncPlanResult{Status: "prClosed", Message: fmt.Sprintf("PR #%d is closed", pr), Account: account}, nil
	}

	session := e.CatFile()
	if session == nil {
		return GhSyncPlanResult{}, ErrRepoTornDown
	}
	if _, err := session.Check(ctx, files.HeadSha); err != nil {
		if errors.Is(err, catfile.ErrMissing) {
			return GhSyncPlanResult{
				Status: "headNotFetched", Account: account, HeadSha: files.HeadSha,
				Message: fmt.Sprintf("PR head %s is not fetched. Refresh the repo first.", short7(files.HeadSha)),
			}, nil
		}
		return GhSyncPlanResult{}, err
	}

	rng, records, err := e.rangeFilesRecords(ctx, base, branch)
	if err != nil {
		return GhSyncPlanResult{}, err
	}
	local := make(map[string]ReviewFileStatus, len(rng.Files))
	for _, f := range rng.Files {
		local[f.Change.Path] = f.Review
	}

	// A PR-head blob is compared only for files that could still be marked.
	var need []string
	for _, f := range files.Files {
		if st, ok := local[f.Path]; ok && st.Kind == "full" && !st.ChangedSinceReview {
			need = append(need, f.Path)
		}
	}
	oids, err := e.blobOIDs(ctx, files.HeadSha, need)
	if err != nil {
		return GhSyncPlanResult{}, err
	}
	prOID := make(map[string]string, len(need))
	for i, p := range need {
		prOID[p] = oids[i]
	}

	out := GhSyncPlanResult{
		Status: "ok", Account: account, HeadSha: files.HeadSha, LocalTip: rng.BranchTip, PrNodeID: files.NodeID,
	}
	out.Files, out.DropSynced = ghSyncFiles(files.Files, files.Truncated, local, records, prOID, synced)
	return out, nil
}

// ghSyncFiles decides every path: the PR's files first, then local or earlier-synced paths the PR
// no longer lists. A truncated PR listing omits files, so the rest stay untouched, ledger rows included.
func ghSyncFiles(
	prFiles []ghclient.PullFile, truncated bool, local map[string]ReviewFileStatus, records map[string]gitreview.FileRecord,
	prOID map[string]string, synced map[string]bool,
) (files []GhSyncFile, drop []string) {
	files = []GhSyncFile{}
	add := func(path string, facts ghSyncFacts) {
		action, reason, dropIt := ghSyncDecision(facts)
		if dropIt {
			drop = append(drop, path)
		}
		if action != "" {
			files = append(files, GhSyncFile{Path: path, Action: action, Reason: reason})
		}
	}
	inPr := make(map[string]bool, len(prFiles))
	for _, f := range prFiles {
		inPr[f.Path] = true
		st, has := local[f.Path]
		kind := "none"
		if has {
			kind = st.Kind
		}
		add(f.Path, ghSyncFacts{
			InPr: true, PrViewed: f.Viewed, Synced: synced[f.Path], Kind: kind, Changed: st.ChangedSinceReview,
			RecordOID: records[f.Path].BlobOID, PrOID: prOID[f.Path],
		})
	}
	if truncated {
		return files, drop
	}
	var rest []string
	for p := range local {
		if !inPr[p] {
			rest = append(rest, p)
		}
	}
	for p := range synced {
		if _, isLocal := local[p]; !isLocal && !inPr[p] {
			rest = append(rest, p)
		}
	}
	sort.Strings(rest)
	for _, p := range rest {
		kind := "none"
		if st, ok := local[p]; ok {
			kind = st.Kind
		}
		add(p, ghSyncFacts{Synced: synced[p], Kind: kind})
	}
	return files, drop
}

// SetPrFilesViewed marks (viewed) or unmarks paths on the PR, honouring the rate-limit breaker.
// failed maps a path to its error; the Status is "ok" unless the whole call failed.
func (e *RepoEntry) SetPrFilesViewed(ctx context.Context, prNodeID string, paths []string, viewed bool) (map[string]string, GhSyncPlanResult) {
	repo, early := e.ghSyncPrefix(ctx)
	if early != nil {
		failed := make(map[string]string, len(paths))
		for _, p := range paths {
			failed[p] = early.Message
		}
		return failed, *early
	}
	failed, status := e.ghClient.SetFilesViewed(ctx, repo, prNodeID, paths, viewed)
	if !status.OK() {
		return failed, *e.ghFailure(status)
	}
	return failed, GhSyncPlanResult{Status: "ok"}
}

func short7(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}
