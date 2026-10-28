package ade

import (
	"context"
	"fmt"
	"strings"

	"golang.org/x/sync/errgroup"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

// linkPlan is a resolved link: the wire target plus what Add must fetch.
type linkPlan struct {
	target adewire.HostLinkTarget
	// refspec is the one fetch Add runs before attaching; "" when the branch is already local or
	// a full fetch of the remote covers it.
	refspec string
	// treeLink marks a branch link: Add fully fetches the remote and resolves again.
	treeLink bool
	// exists is false when a branch link names no branch on disk yet.
	exists  bool
	title   string
	hostURL string
}

// ResolveHostLink names the branch a pasted link points at. It fetches nothing and writes no ref.
func (b *TaskBoard) ResolveHostLink(ctx context.Context, args adewire.HostLinkArgs) (adewire.HostLinkTarget, error) {
	plan, err := b.resolveHostLink(ctx, args.URL)
	if err != nil {
		return adewire.HostLinkTarget{}, err
	}
	return plan.target, nil
}

// AddHostLink re-resolves the link, fetches its branch and attaches it like AddExistingBranch.
func (b *TaskBoard) AddHostLink(ctx context.Context, args adewire.HostLinkArgs) (adewire.AddExistingBranchResult, error) {
	plan, err := b.resolveHostLink(ctx, args.URL)
	if err != nil {
		return adewire.AddExistingBranchResult{}, err
	}
	if plan.target.OnTaskID != "" {
		return adewire.AddExistingBranchResult{}, repos.ErrBranchOnTask
	}
	if args.TaskID != "" {
		if _, err := b.deps.Tasks.GetTask(args.TaskID); err != nil {
			return adewire.AddExistingBranchResult{}, err
		}
	}
	if plan, err = b.fetchHostLink(ctx, args.URL, plan); err != nil {
		return adewire.AddExistingBranchResult{}, err
	}
	t := plan.target
	var sb model.AdeTaskBranch
	res, err := b.attachExistingBranch(ctx, adewire.AddExistingBranchArgs{CodeRepoID: t.CodeRepoID, Name: t.Branch, TaskID: args.TaskID}, &sb,
		newTaskFields{Title: plan.title, HostURL: plan.hostURL})
	if err != nil {
		return res, err
	}
	if sb.Kind != model.AdeBranchKindReview {
		b.prepareAttached(ctx, sb)
	}
	return res, nil
}

// fetchHostLink runs the fetches a plan needs under the repo mutex, released before the attach
// takes it again.
func (b *TaskBoard) fetchHostLink(ctx context.Context, raw string, plan linkPlan) (linkPlan, error) {
	t := plan.target
	mu := b.repoMutex(t.CodeRepoID)
	mu.Lock()
	defer mu.Unlock()
	entry, err := b.openRepo(ctx, t.CodeRepoID)
	if err != nil {
		return plan, err
	}
	run := func(p gitsession.RemoteOpParams) error {
		res, err := entry.RunRemote(ctx, b.conn, p, gitsession.RemoteDeps{Askpass: b.deps.Askpass})
		if err != nil {
			return err
		}
		if !res.OK {
			return invalid("%s", res.Error.Message)
		}
		return nil
	}
	if plan.treeLink {
		if err := run(gitsession.RemoteOpParams{Kind: "fetch", Remote: t.Remote}); err != nil {
			return plan, err
		}
		if plan, err = b.resolveHostLink(ctx, raw); err != nil {
			return plan, err
		}
		if !plan.exists {
			return plan, invalid("branch %q not found on %s", plan.target.Branch, t.Remote)
		}
		if plan.target.OnTaskID != "" {
			return plan, repos.ErrBranchOnTask
		}
	}
	if plan.refspec != "" {
		if err := run(gitsession.RemoteOpParams{Kind: "fetch", Remote: plan.target.Remote, Refspecs: []string{plan.refspec}}); err != nil {
			return plan, err
		}
	}
	return plan, nil
}

func (b *TaskBoard) resolveHostLink(ctx context.Context, raw string) (linkPlan, error) {
	if b.deps.Registry == nil || b.deps.Registry.Hosts.Registry == nil {
		return linkPlan{}, invalid("no git host is available")
	}
	reg := b.deps.Registry.Hosts.Registry
	p, bl, link, ok := reg.ParseBranchLink(ctx, raw)
	if !ok {
		if labels := reg.BranchLinkLabels(); labels != "" {
			return linkPlan{}, invalid("paste a %s", labels)
		}
		return linkPlan{}, invalid("no git host is available")
	}
	if link.Issue {
		return linkPlan{}, invalid("An issue link names no branch. Paste its pull request or branch link.")
	}
	var plan linkPlan
	repoID, remote, err := b.matchHostRepo(ctx, p, link.Repo)
	if err != nil {
		return plan, err
	}
	if repoID == "" {
		return plan, invalid("No repo in your workspace has a remote for %s/%s/%s. Add the repo first.", link.Repo.Host, link.Repo.Owner, link.Repo.Name)
	}
	var head githost.ChangeRequestHead
	if link.Number > 0 {
		var st githost.Status
		if head, st = bl.ChangeRequestHead(ctx, link.Repo, link.Number); !st.OK() {
			if st.Gone {
				return plan, invalid("%s #%d not found on %s/%s/%s, or your %s account cannot see it",
					p.Terms().ChangeRequest, link.Number, link.Repo.Host, link.Repo.Owner, link.Repo.Name, p.Terms().Label)
			}
			return plan, invalid("%s", st.Reason)
		}
		if head.State == "merged" {
			return plan, invalid("%s #%d is already merged", p.Terms().ChangeRequestShort, link.Number)
		}
	}
	entry, err := b.openRepo(ctx, repoID)
	if err != nil {
		return plan, err
	}
	inv, err := entry.BranchInventory(ctx)
	if err != nil {
		return plan, err
	}
	defaultRemote, _ := entry.DefaultRemote(ctx)
	hasLocal := func(name string) bool {
		for _, r := range inv {
			if r.Remote == "" && r.Short == name {
				return true
			}
		}
		return false
	}
	t := adewire.HostLinkTarget{CodeRepoID: repoID, Remote: remote}
	plan.exists = true

	if link.Number > 0 {
		t.Author = head.Author
		t.ChangeRequest = &adewire.ChangeRequest{Number: head.Number, Title: head.Title, State: head.State, URL: head.URL}
		sameRepo := head.HeadOwner != "" && strings.EqualFold(head.HeadOwner, link.Repo.Owner)
		t.Fork = !sameRepo
		switch {
		case sameRepo:
			t.Branch = head.HeadRef
		case head.HeadOwner != "":
			t.HeadOwner, t.Branch = head.HeadOwner, head.HeadOwner+"/"+head.HeadRef
		default:
			t.Branch = fmt.Sprintf("pr-%d", head.Number)
		}
		open := head.State == "open" || head.State == "draft"
		if !hasLocal(t.Branch) {
			if sameRepo && open && remote == defaultRemote {
				plan.refspec = "+refs/heads/" + t.Branch + ":refs/remotes/" + remote + "/" + t.Branch
			} else {
				plan.refspec = bl.ChangeRequestRef(head.Number) + ":refs/heads/" + t.Branch
			}
		}
		plan.title = head.Title
		if _, ok := reg.ParseLink(head.URL); ok {
			plan.hostURL = head.URL
		}
	} else {
		plan.treeLink = true
		t.Branch, plan.exists = pickTreeBranch(inv, remote, link.TreePath)
		if plan.exists && !hasLocal(t.Branch) && remote != defaultRemote {
			plan.refspec = "refs/heads/" + t.Branch + ":refs/heads/" + t.Branch
		}
	}

	if !t.Fork {
		if ref, _, ok, err := entry.MainRef(ctx); err == nil && ok {
			if mainName, _ := mainDisplay(ref); mainName == t.Branch {
				return plan, invalid("%s is the repo's main branch", t.Branch)
			}
		}
	}
	valid, err := entry.CheckBranchName(ctx, t.Branch)
	if err != nil {
		return plan, err
	}
	if !valid || strings.ContainsAny(t.Branch, ": ") {
		return plan, invalid("%q is not a usable branch name", t.Branch)
	}
	live, err := b.deps.Tasks.BranchesLive()
	if err != nil {
		return plan, err
	}
	for _, br := range live {
		if br.CodeRepoID == repoID && br.Name == t.Branch {
			t.OnTaskID = br.TaskID
		}
	}
	plan.target = t
	return plan, nil
}

// pickTreeBranch takes the longest segment prefix of path that names a local branch or a branch of
// remote. None found: the whole path, reported as not existing.
func pickTreeBranch(inv []porcelain.InventoryRef, remote, path string) (string, bool) {
	known := map[string]bool{}
	for _, r := range inv {
		if r.Remote == "" || r.Remote == remote {
			known[r.Short] = true
		}
	}
	segs := strings.Split(path, "/")
	for n := len(segs); n > 0; n-- {
		if name := strings.Join(segs[:n], "/"); known[name] {
			return name, true
		}
	}
	return path, false
}

// matchHostRepo finds the first code repo, in list order, with a remote for the host repo.
func (b *TaskBoard) matchHostRepo(ctx context.Context, p githost.Provider, r githost.Repo) (id, remote string, err error) {
	recs, err := b.deps.CodeRepos.List()
	if err != nil {
		return "", "", err
	}
	remotes := make([]string, len(recs))
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(boardFanOut)
	for i, rec := range recs {
		g.Go(func() error {
			entry, err := b.openRepo(gctx, rec.ID)
			if err != nil {
				return nil
			}
			remotes[i], _ = entry.RemoteFor(gctx, p, r)
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return "", "", err
	}
	for i, name := range remotes {
		if name != "" {
			return recs[i].ID, name, nil
		}
	}
	return "", "", nil
}
