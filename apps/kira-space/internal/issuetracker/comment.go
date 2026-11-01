package issuetracker

import "context"

// MaxCommentBytes bounds a posted comment; Jira caps a text field at 32,767 characters.
const MaxCommentBytes = 32 << 10

// IssueComments is optional: a tracker the issue view can post to. Separate from IssueDetails (read).
type IssueComments interface {
	// PostIssueComment posts Markdown. Failures are the typed errors of errors.go.
	PostIssueComment(ctx context.Context, ref Ref, body string) error
}
