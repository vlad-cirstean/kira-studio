package azure

import (
	"context"
	"log/slog"
	"regexp"
	"strconv"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

// devopsResource is Azure DevOps' documented Entra ID resource id.
const devopsResource = "499b84ac-1321-427f-aa17-267ca6975798"

var threadIDPattern = regexp.MustCompile(`^\d{1,10}$`)

func (p *Provider) CommentCapabilities(githost.Repo) githost.CommentCapabilities {
	return githost.CommentCapabilities{
		ReplyKinds:  []string{githost.ThreadComment, githost.ThreadCode},
		Attachments: true,
	}
}

type uploaded struct{ stored string }

// PostChangeRequestComment posts c. Attachments upload first and ride as links in the body; any
// failure after an upload removes the files again.
func (p *Provider) PostChangeRequestComment(ctx context.Context, r githost.Repo, number int, c githost.NewComment) githost.Status {
	org, project, ok := split(r)
	if !ok {
		return invalidRepo(r)
	}
	site := orgURL(org)
	if c.ReplyTo != "" && !threadIDPattern.MatchString(c.ReplyTo) {
		return status(site, githost.KindForbidden, "no such thread")
	}
	body := c.Body
	var token string
	var done []uploaded
	cleanup := func() {
		for _, u := range done {
			p.uploader.remove(context.WithoutCancel(ctx), token, org, project, r.Name, number, u.stored)
		}
		if len(done) > 0 {
			slog.Warn("azure: removed attachments of a failed comment", "scope", "githost", "count", len(done))
		}
	}
	if len(c.Attachments) > 0 {
		var st githost.Status
		if token, st = p.client.accessToken(ctx, org); !st.OK() {
			return st
		}
		var links []string
		for _, a := range c.Attachments {
			link, stored, st := p.uploader.upload(ctx, token, org, project, r.Name, number, a)
			if !st.OK() {
				cleanup()
				return st
			}
			done = append(done, uploaded{stored})
			md := githost.AttachmentMarkdown(a.Name, link, isImage(a.ContentType))
			if md == "" {
				cleanup()
				return status(site, githost.KindForbidden, "Azure DevOps returned an unusable attachment link")
			}
			links = append(links, md)
		}
		body += "\n\n" + strings.Join(links, "\n")
		if len(body) > githost.MaxHostCommentBytes {
			cleanup()
			return status(site, githost.KindForbidden, "comment is too long with attachment links")
		}
	}
	var st githost.Status
	if c.ReplyTo == "" {
		st = p.Comment(ctx, r, number, body)
	} else {
		route := []string{"project=" + project, "repositoryId=" + r.Name, "pullRequestId=" + strconv.Itoa(number), "threadId=" + c.ReplyTo}
		// Azure numbers a thread's comments from 1; the first comment is the thread's root.
		reply := map[string]any{"content": body, "parentCommentId": 1, "commentType": 1}
		st = p.client.invoke(ctx, site, true, "POST", "pullRequestThreadComments", route, "", reply, nil)
	}
	if !st.OK() {
		cleanup()
	}
	return st
}

func isImage(contentType string) bool {
	switch contentType {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
		return true
	}
	return false
}

// accessToken asks az for a short-lived Azure DevOps token. It stays in the caller's variable.
func (c *Client) accessToken(ctx context.Context, org string) (string, githost.Status) {
	site := orgURL(org)
	st := c.discovery.Status(ctx, site)
	if !st.OK() {
		return "", st
	}
	out, err := runWithin(ctx, c.runner, st.Path, callTimeout,
		[]string{"account", "get-access-token", "--resource", devopsResource, "--query", "accessToken", "-o", "tsv"})
	if res := classify(site, err, ctx.Err(), false); !res.OK() {
		if res.Kind == githost.KindUnauthenticated {
			res.Reason = reasonAttachSignIn
		}
		return "", res
	}
	token := strings.TrimSpace(string(out))
	if token == "" || strings.ContainsAny(token, " \t\r\n") {
		return "", status(site, githost.KindUnauthenticated, reasonAttachSignIn)
	}
	return token, st
}
