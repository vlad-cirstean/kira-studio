package github

import (
	"context"
	"regexp"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

var _ githost.ChangeRequestComments = (*Provider)(nil)

// threadIDPattern is a review thread node id.
var threadIDPattern = regexp.MustCompile(`^PRRT_[A-Za-z0-9_-]{1,200}$`)

const replyThreadMutation = `mutation($threadId:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body}){comment{id}}}`

func (p *Provider) ReplyKinds(githost.Repo) []string { return []string{githost.ThreadCode} }

func (p *Provider) PostChangeRequestComment(ctx context.Context, r githost.Repo, number int, c githost.NewComment) githost.Status {
	if c.ReplyTo == "" {
		return p.Comment(ctx, r, number, c.Body)
	}
	if !threadIDPattern.MatchString(c.ReplyTo) {
		return githost.Status{Kind: githost.KindForbidden, Host: r.Host, Reason: "no such thread"}
	}
	st, errs := p.client.graphqlWithin(ctx, Repo(r), replyThreadMutation,
		[]GraphQLVar{{Name: "threadId", Str: c.ReplyTo}, {Name: "body", Str: c.Body}}, nil, writeTimeout, true)
	if st.OK() && len(errs) > 0 {
		st = Status{Kind: KindForbidden, Host: r.Host, Reason: reasonOrDefault(errs[0].Message, "GitHub rejected the reply")}
	}
	return toStatus(st)
}
