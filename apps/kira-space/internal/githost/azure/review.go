package azure

import (
	"context"
	"strconv"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

// voteOf maps a neutral review event onto az's --vote; ReviewComment casts none. Azure votes carry
// no commit, so Review.CommitSHA is not sent.
var voteOf = map[string]string{
	githost.ReviewApprove:        "approve",
	githost.ReviewRequestChanges: "wait-for-author",
}

func (p *Provider) ReviewTarget(ctx context.Context, r githost.Repo, number int) (githost.ReviewTarget, githost.Status) {
	raw, st := p.client.prShow(ctx, r, number)
	if !st.OK() {
		return githost.ReviewTarget{}, st
	}
	cr := mapPR(r, raw)
	return githost.ReviewTarget{Title: cr.Title, State: cr.State, HeadSha: cr.HeadSha, Author: raw.Author}, st
}

func (p *Provider) Comment(ctx context.Context, r githost.Repo, number int, body string) githost.Status {
	org, project, ok := split(r)
	if !ok {
		return invalidRepo(r)
	}
	thread := map[string]any{
		"comments": []map[string]any{{"parentCommentId": 0, "content": body, "commentType": 1}},
		"status":   1, // active
	}
	route := []string{"project=" + project, "repositoryId=" + r.Name, "pullRequestId=" + strconv.Itoa(number)}
	return p.client.invoke(ctx, orgURL(org), true, "POST", "pullRequestThreads", route, "", thread, nil)
}

// SubmitReview posts the body as a new thread, then casts the vote.
func (p *Provider) SubmitReview(ctx context.Context, r githost.Repo, number int, rv githost.Review) githost.Status {
	org, _, ok := split(r)
	if !ok {
		return invalidRepo(r)
	}
	vote, hasVote := voteOf[rv.Event]
	if !hasVote && rv.Event != githost.ReviewComment {
		return status(orgURL(org), githost.KindForbidden, "unknown review event "+rv.Event)
	}
	st := status(orgURL(org), githost.KindOK, "")
	if rv.Body != "" {
		if st = p.Comment(ctx, r, number, rv.Body); !st.OK() {
			return st
		}
	}
	if !hasVote {
		return st
	}
	_, st = p.client.call(ctx, orgURL(org), true,
		argv([]string{"repos", "pr", "set-vote"}, orgURL(org), "--id", strconv.Itoa(number), "--vote", vote))
	return st
}
