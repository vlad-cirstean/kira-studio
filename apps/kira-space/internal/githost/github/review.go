package github

import (
	"context"
	"fmt"
	"time"
)

// PullReview is the review facts of one pull request.
type PullReview struct {
	Title   string
	State   string // "open" | "draft" | "merged" | "closed"
	HeadSha string
	Author  string // "" when GitHub reports user as null (a deleted account)
}

type rawReviewPull struct {
	Title  string  `json:"title"`
	State  string  `json:"state"`
	Draft  bool    `json:"draft"`
	Merged *string `json:"merged_at"`
	Head   struct {
		Sha string `json:"sha"`
	} `json:"head"`
	User *struct {
		Login string `json:"login"`
	} `json:"user"`
}

// reviewEvents maps the neutral event names onto GitHub's.
var reviewEvents = map[string]string{
	"approve":        "APPROVE",
	"comment":        "COMMENT",
	"requestChanges": "REQUEST_CHANGES",
}

type field struct{ key, value string }

// writeArgv builds a POST `gh api` argv. Every field travels via `-f`, never `-F`: `-F` reads an
// `@`-prefixed value from a local file, and a body often starts with an @mention.
func writeArgv(host, path string, fields []field) []string {
	args := methodArgv(host, "POST", path)
	for _, f := range fields {
		args = append(args, "-f", f.key+"="+f.value)
	}
	return args
}

// PullForReview reads the facts a review depends on: `repos/{owner}/{repo}/pulls/{n}`.
func (c *Client) PullForReview(ctx context.Context, repo Repo, number int) (PullReview, Status) {
	var raw rawReviewPull
	status := c.get(ctx, repo, fmt.Sprintf("repos/%s/pulls/%d", repo.Path(), number), &raw)
	if !status.OK() {
		return PullReview{}, status
	}
	out := PullReview{Title: raw.Title, State: deriveState(raw.State, raw.Draft, raw.Merged), HeadSha: raw.Head.Sha}
	if raw.User != nil {
		out.Author = raw.User.Login
	}
	return out, status
}

// writeTimeout bounds a mutating `gh api` call. POSTs are slow on large PRs and are never retried.
const (
	writeTimeout       = 30 * time.Second
	writeTimeoutReason = "GitHub did not respond within 30s. The request may have been recorded; open the PR to check before trying again"
)

// SubmitReview creates and submits a review in one call. An empty body is left out of the request.
func (c *Client) SubmitReview(ctx context.Context, repo Repo, number int, event, body, commitID string) Status {
	ghEvent, ok := reviewEvents[event]
	if !ok {
		return Status{Kind: KindForbidden, Host: repo.Host, Reason: "unknown review event " + event}
	}
	fields := []field{{"event", ghEvent}, {"commit_id", commitID}}
	if body != "" {
		fields = append(fields, field{"body", body})
	}
	path := fmt.Sprintf("repos/%s/pulls/%d/reviews", repo.Path(), number)
	return c.callWithin(ctx, repo, writeArgv(repo.Host, path, fields), nil, writeTimeout, true)
}

// CommentOnPull posts a conversation comment: `repos/{owner}/{repo}/issues/{n}/comments`.
func (c *Client) CommentOnPull(ctx context.Context, repo Repo, number int, body string) Status {
	path := fmt.Sprintf("repos/%s/issues/%d/comments", repo.Path(), number)
	return c.callWithin(ctx, repo, writeArgv(repo.Host, path, []field{{"body", body}}), nil, writeTimeout, true)
}
