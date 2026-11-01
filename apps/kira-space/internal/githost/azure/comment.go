package azure

import (
	"context"
	"regexp"
	"strconv"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

var threadIDPattern = regexp.MustCompile(`^\d{1,10}$`)

func (p *Provider) ReplyKinds(githost.Repo) []string {
	return []string{githost.ThreadComment, githost.ThreadCode}
}

// PostChangeRequestComment posts c as a new comment or a reply.
func (p *Provider) PostChangeRequestComment(ctx context.Context, r githost.Repo, number int, c githost.NewComment) githost.Status {
	org, project, ok := split(r)
	if !ok {
		return invalidRepo(r)
	}
	site := orgURL(org)
	if c.ReplyTo != "" && !threadIDPattern.MatchString(c.ReplyTo) {
		return status(site, githost.KindForbidden, "no such thread")
	}
	if c.ReplyTo == "" {
		return p.Comment(ctx, r, number, c.Body)
	}
	route := []string{"project=" + project, "repositoryId=" + r.Name, "pullRequestId=" + strconv.Itoa(number), "threadId=" + c.ReplyTo}
	// Azure numbers a thread's comments from 1; the first comment is the thread's root.
	reply := map[string]any{"content": c.Body, "parentCommentId": 1, "commentType": 1}
	return p.client.invoke(ctx, site, true, "POST", "pullRequestThreadComments", route, "", reply, nil)
}
