package githost

import "context"

// NewComment is one comment to post.
type NewComment struct {
	Body    string // Markdown, 1..MaxHostCommentBytes
	ReplyTo string // a Thread.ID; "" posts a new top-level comment
}

// ChangeRequestComments is optional: a provider the PR view can post to. Separate from
// ChangeRequestDetails (read) and ChangeRequestReviews (review window). Failure is in Status, never an error.
type ChangeRequestComments interface {
	ReplyKinds(r Repo) []string // Thread kinds a reply may target
	PostChangeRequestComment(ctx context.Context, r Repo, number int, c NewComment) Status
}
