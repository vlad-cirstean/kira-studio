package gitsession

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/catfile"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
)

// viewedsync.go: the one-way app -> code host "viewed" file sync plan. The rules live in viewedSyncDecision.

// ViewedSyncFile is one row of a sync plan: Action is "mark" | "unmark" | "alreadyViewed" | "skip",
// Reason names why a file is skipped.
type ViewedSyncFile struct {
	Path   string
	Action string
	Reason string
}

// ViewedSyncPlanResult is ViewedSyncPlan's outcome. Status is "ok" | "disabled" | "unsupported" |
// "cliMissing" | "unauthenticated" | "unavailable" | "prClosed" | "headNotFetched". Files,
// DropSynced and NodeID are set only for "ok". DropSynced lists ledger rows to delete without a
// host call.
type ViewedSyncPlanResult struct {
	Status     string
	Message    string
	Account    string
	HeadSha    string
	LocalTip   string
	NodeID     string
	Files      []ViewedSyncFile
	DropSynced []string
}

// viewedSyncFacts is everything the decision for one path needs.
type viewedSyncFacts struct {
	InPr, PrViewed bool
	Synced         bool   // this app marked it on the host
	Kind           string // review kind: "none" | "partial" | "full"
	Changed        bool   // local tip blob differs from the reviewed blob
	RecordOID      string
	PrOID          string // blob oid at the PR head
}

// viewedSyncDecision applies the rules in order; action "" omits the path from the plan.
func viewedSyncDecision(f viewedSyncFacts) (action, reason string, dropSynced bool) {
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

// ViewedSyncStatusKind maps a failed host status to a viewed-sync status.
func ViewedSyncStatusKind(s githost.Status) string {
	switch s.Kind {
	case githost.KindNotFound:
		return "cliMissing"
	case githost.KindUnauthenticated:
		return "unauthenticated"
	}
	return "unavailable"
}

// viewedSyncPrefix resolves the host and its file review role, or reports why a sync cannot run:
// the setting is off, no host matches the remote, the host has no file review, or the breaker is
// armed.
func (e *RepoEntry) viewedSyncPrefix(ctx context.Context) (githost.FileReviewSync, githost.Provider, githost.Repo, *ViewedSyncPlanResult) {
	p, repo, ok := e.hostRepo(ctx)
	if !ok {
		return nil, nil, repo, &ViewedSyncPlanResult{Status: "disabled", Message: e.DisabledMessage()}
	}
	rs, ok := p.(githost.FileReviewSync)
	if !ok {
		return nil, p, repo, &ViewedSyncPlanResult{
			Status: "unsupported", Message: fmt.Sprintf("%s cannot sync viewed files", p.Terms().Label),
		}
	}
	if status, armed := e.host.breakerStatus(); armed {
		return nil, p, repo, &ViewedSyncPlanResult{Status: "unavailable", Message: status.Reason}
	}
	return rs, p, repo, nil
}

// DisabledMessage says why no host serves this entry: the setting is off, or the remote matches no
// registered host.
func (e *RepoEntry) DisabledMessage() string {
	if e.hostSetting() == githost.SettingOff {
		return fmt.Sprintf("%s is turned off for this repo", e.hosts.Registry.Labels())
	}
	return "This repo has no remote on a known code host"
}

func (e *RepoEntry) viewedSyncFailure(status githost.Status) *ViewedSyncPlanResult {
	if status.RateLimited {
		e.host.armBreaker(status)
	}
	return &ViewedSyncPlanResult{Status: ViewedSyncStatusKind(status), Message: status.Reason}
}

// ViewedSyncPlan computes what a sync of branch (against base) to change request number would do.
// synced holds the paths this app marked earlier. A non-nil error is a local failure (git, review.db).
func (e *RepoEntry) ViewedSyncPlan(ctx context.Context, branch, base string, number int, synced map[string]bool) (ViewedSyncPlanResult, error) {
	rs, p, repo, early := e.viewedSyncPrefix(ctx)
	if early != nil {
		return *early, nil
	}
	account := p.Account(ctx, repo.Host)
	files, status := rs.ChangeFiles(ctx, repo, number)
	if !status.OK() {
		res := e.viewedSyncFailure(status)
		res.Account = account
		return *res, nil
	}
	if !files.Open {
		return ViewedSyncPlanResult{
			Status: "prClosed", Account: account,
			Message: fmt.Sprintf("%s #%d is closed", p.Terms().ChangeRequestShort, number),
		}, nil
	}

	session := e.CatFile()
	if session == nil {
		return ViewedSyncPlanResult{}, ErrRepoTornDown
	}
	if _, err := session.Check(ctx, files.HeadSha); err != nil {
		if errors.Is(err, catfile.ErrMissing) {
			return ViewedSyncPlanResult{
				Status: "headNotFetched", Account: account, HeadSha: files.HeadSha,
				Message: fmt.Sprintf("%s head %s is not fetched. Refresh the repo first.", p.Terms().ChangeRequestShort, gitclient.ShortSHA(files.HeadSha)),
			}, nil
		}
		return ViewedSyncPlanResult{}, err
	}

	rng, records, err := e.rangeFilesRecords(ctx, base, branch)
	if err != nil {
		return ViewedSyncPlanResult{}, err
	}
	local := make(map[string]ReviewFileStatus, len(rng.Files))
	for _, f := range rng.Files {
		local[f.Change.Path] = f.Review
	}

	// A head blob is compared only for files that could still be marked.
	var need []string
	for _, f := range files.Files {
		if st, ok := local[f.Path]; ok && st.Kind == "full" && !st.ChangedSinceReview {
			need = append(need, f.Path)
		}
	}
	oids, err := e.blobOIDs(ctx, files.HeadSha, need)
	if err != nil {
		return ViewedSyncPlanResult{}, err
	}
	prOID := make(map[string]string, len(need))
	for i, p := range need {
		prOID[p] = oids[i]
	}

	out := ViewedSyncPlanResult{
		Status: "ok", Account: account, HeadSha: files.HeadSha, LocalTip: rng.BranchTip, NodeID: files.NodeID,
	}
	out.Files, out.DropSynced = viewedSyncFiles(files.Files, files.Truncated, local, records, prOID, synced)
	return out, nil
}

// viewedSyncFiles decides every path: the PR's files first, then local or earlier-synced paths the PR
// no longer lists. A truncated PR listing omits files, so the rest stay untouched, ledger rows included.
func viewedSyncFiles(
	prFiles []githost.ChangedFile, truncated bool, local map[string]ReviewFileStatus, records map[string]gitreview.FileRecord,
	prOID map[string]string, synced map[string]bool,
) (files []ViewedSyncFile, drop []string) {
	files = []ViewedSyncFile{}
	add := func(path string, facts viewedSyncFacts) {
		action, reason, dropIt := viewedSyncDecision(facts)
		if dropIt {
			drop = append(drop, path)
		}
		if action != "" {
			files = append(files, ViewedSyncFile{Path: path, Action: action, Reason: reason})
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
		add(f.Path, viewedSyncFacts{
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
		add(p, viewedSyncFacts{Synced: synced[p], Kind: kind})
	}
	return files, drop
}

// SetChangeFilesViewed marks (viewed) or unmarks paths on the change request, honouring the
// rate-limit breaker. failed maps a path to its error; the Status is "ok" unless the whole call failed.
func (e *RepoEntry) SetChangeFilesViewed(ctx context.Context, nodeID string, paths []string, viewed bool) (map[string]string, ViewedSyncPlanResult) {
	rs, _, repo, early := e.viewedSyncPrefix(ctx)
	if early != nil {
		failed := make(map[string]string, len(paths))
		for _, p := range paths {
			failed[p] = early.Message
		}
		return failed, *early
	}
	failed, status := rs.SetFilesViewed(ctx, repo, nodeID, paths, viewed)
	if !status.OK() {
		return failed, *e.viewedSyncFailure(status)
	}
	return failed, ViewedSyncPlanResult{Status: "ok"}
}
