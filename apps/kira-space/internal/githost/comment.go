package githost

import (
	"context"
	"strings"
)

// Attachment limits shared by every provider and the bridge.
const (
	MaxAttachments          = 5
	MaxAttachmentBytes      = 10 << 20
	MaxAttachmentTotalBytes = 25 << 20
)

// CommentCapabilities says what a provider's comment composer may do.
type CommentCapabilities struct {
	ReplyKinds        []string `json:"replyKinds"` // Thread kinds a reply may target
	Attachments       bool     `json:"attachments"`
	AttachmentsReason string   `json:"attachmentsReason,omitempty"` // why not, when false
}

// NewComment is one comment to post.
type NewComment struct {
	Body        string       // Markdown, 1..MaxHostCommentBytes after attachment links are appended
	ReplyTo     string       // a Thread.ID; "" posts a new top-level comment
	Attachments []Attachment // only when CommentCapabilities.Attachments
}

// Attachment is one file for a comment.
type Attachment struct {
	Name        string // sanitized, unique per comment
	ContentType string // sniffed
	Data        []byte
}

// ChangeRequestComments is optional: a provider the PR view can post to. Separate from
// ChangeRequestDetails (read) and ChangeRequestReviews (review window). Failure is in Status, never an error.
type ChangeRequestComments interface {
	CommentCapabilities(r Repo) CommentCapabilities
	PostChangeRequestComment(ctx context.Context, r Repo, number int, c NewComment) Status
}

var markdownEscaper = strings.NewReplacer(`\`, `\\`, `[`, `\[`, `]`, `\]`, `(`, `\(`, `)`, `\)`)

// AttachmentMarkdown links an uploaded file: an image embed or a plain link. It returns "" for a
// url that is not https, so the caller fails the post.
func AttachmentMarkdown(name, url string, image bool) string {
	if !strings.HasPrefix(url, "https://") || strings.ContainsAny(url, " \t\r\n()<>") {
		return ""
	}
	link := "[" + markdownEscaper.Replace(name) + "](" + url + ")"
	if image {
		return "!" + link
	}
	return link
}
