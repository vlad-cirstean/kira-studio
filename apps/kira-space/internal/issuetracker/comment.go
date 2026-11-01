package issuetracker

import "context"

// MaxCommentBytes bounds a posted comment; Jira caps a text field at 32,767 characters.
const MaxCommentBytes = 32 << 10

// CommentCapabilities says what a tracker's comment composer may do.
type CommentCapabilities struct {
	Attachments       bool   `json:"attachments"`
	AttachmentsReason string `json:"attachmentsReason,omitempty"` // why not, when false
}

// IssueComments is optional: a tracker the issue view can post to. Separate from IssueDetails (read).
type IssueComments interface {
	CommentCapabilities() CommentCapabilities
	// PostIssueComment posts Markdown. Failures are the typed errors of errors.go.
	PostIssueComment(ctx context.Context, ref Ref, body string) error
}
