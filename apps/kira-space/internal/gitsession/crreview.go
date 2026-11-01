package gitsession

import (
	"context"
	"errors"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

// ChangeRequestReviewState is changeRequest.reviewState's result. Kind is "ok" | "disabled" |
// "none" | "unavailable".
type ChangeRequestReviewState struct {
	Kind                                                string
	Status                                              *githost.Status
	Host                                                githost.Info
	Number                                              int
	Title, State, HeadSha, LocalHeadSha, Author, Viewer string
	Own                                                 bool
}

// ChangeRequestPost is the result of a review or comment post. Kind is "ok" | "disabled" | "unavailable".
type ChangeRequestPost struct {
	Kind   string
	Status *githost.Status
}

func (e *RepoEntry) reviewHost(ctx context.Context) (githost.Provider, githost.ChangeRequestReviews, githost.Repo, bool) {
	p, repo, ok := e.hostRepo(ctx)
	if !ok {
		return nil, nil, githost.Repo{}, false
	}
	rv, ok := p.(githost.ChangeRequestReviews)
	if !ok {
		return nil, nil, githost.Repo{}, false
	}
	return p, rv, repo, true
}

func reviewUnavailable(status githost.Status) ChangeRequestReviewState {
	s := status
	return ChangeRequestReviewState{Kind: "unavailable", Status: &s}
}

// hostHeadName is the head name the host knows branch by: an origin remote-tracking spelling
// ("origin/feat/x") loses its remote prefix; any other spelling is returned as is.
func (e *RepoEntry) hostHeadName(ctx context.Context, branch string) (string, error) {
	snapshot, err := e.Refs(ctx)
	if err != nil {
		return "", err
	}
	for _, r := range snapshot.Branches {
		if r.ShortName == branch {
			return branch, nil
		}
	}
	for _, r := range snapshot.RemoteBranches {
		if r.ShortName == branch {
			if head, ok := strings.CutPrefix(r.Refname, "refs/remotes/origin/"); ok {
				return head, nil
			}
			break
		}
	}
	return branch, nil
}

// ChangeRequestReviewState reads the review facts of a change request, fresh from the host.
// number > 0 names it; otherwise it is the one found for branch by its host head name.
func (e *RepoEntry) ChangeRequestReviewState(ctx context.Context, branch string, number int) (ChangeRequestReviewState, error) {
	p, rv, repo, ok := e.reviewHost(ctx)
	if !ok {
		return ChangeRequestReviewState{Kind: "disabled"}, nil
	}
	title := ""
	if number <= 0 {
		head, err := e.hostHeadName(ctx, branch)
		if err != nil {
			return ChangeRequestReviewState{}, err
		}
		lookup := e.ResolveBranchChangeRequest(ctx, head)
		switch lookup.Kind {
		case "disabled":
			return ChangeRequestReviewState{Kind: "disabled"}, nil
		case "unavailable":
			return ChangeRequestReviewState{Kind: "unavailable", Status: lookup.Status}, nil
		}
		if len(lookup.ChangeRequests) == 0 {
			return ChangeRequestReviewState{Kind: "none"}, nil
		}
		number, title = lookup.ChangeRequests[0].Number, lookup.ChangeRequests[0].Title
	}

	if status, armed := e.host.breakerStatus(); armed {
		return reviewUnavailable(status), nil
	}
	t, status := rv.ReviewTarget(ctx, repo, number)
	if !status.OK() {
		if status.RateLimited {
			e.host.armBreaker(status)
		}
		return reviewUnavailable(status), nil
	}
	if t.Title != "" {
		title = t.Title
	}

	local, err := e.branchTip(ctx, branch)
	if err != nil && !errors.Is(err, ErrBranchNotFound) {
		return ChangeRequestReviewState{}, err
	}
	if err != nil {
		local = ""
	}
	viewer := p.Account(ctx, repo)
	return ChangeRequestReviewState{
		Kind: "ok", Host: githost.Describe(p), Number: number, Title: title, State: t.State,
		HeadSha: t.HeadSha, LocalHeadSha: local, Author: t.Author, Viewer: viewer,
		Own: t.Author != "" && strings.EqualFold(t.Author, viewer),
	}, nil
}

// SubmitChangeRequestReview posts a review on change request number.
func (e *RepoEntry) SubmitChangeRequestReview(ctx context.Context, number int, review githost.Review) ChangeRequestPost {
	return e.post(ctx, func(rv githost.ChangeRequestReviews, repo githost.Repo) githost.Status {
		return rv.SubmitReview(ctx, repo, number, review)
	})
}

// CommentOnChangeRequest posts a conversation comment on change request number.
func (e *RepoEntry) CommentOnChangeRequest(ctx context.Context, number int, body string) ChangeRequestPost {
	return e.post(ctx, func(rv githost.ChangeRequestReviews, repo githost.Repo) githost.Status {
		return rv.Comment(ctx, repo, number, body)
	})
}

func (e *RepoEntry) post(ctx context.Context, fn func(githost.ChangeRequestReviews, githost.Repo) githost.Status) ChangeRequestPost {
	_, rv, repo, ok := e.reviewHost(ctx)
	if !ok {
		return ChangeRequestPost{Kind: "disabled"}
	}
	if status, armed := e.host.breakerStatus(); armed {
		return ChangeRequestPost{Kind: "unavailable", Status: &status}
	}
	status := fn(rv, repo)
	if status.OK() {
		// Non-waiting: board badges pick up the new review decision within the sync gates.
		e.SyncChangeRequests(ctx, nil, false)
		return ChangeRequestPost{Kind: "ok"}
	}
	if status.RateLimited {
		e.host.armBreaker(status)
	}
	return ChangeRequestPost{Kind: "unavailable", Status: &status}
}
