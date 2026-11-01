package bridge

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"path"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/issuetracker"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

const (
	maxReplyToBytes = 256
	// stagedAttachmentTTL drops a staged file nobody posted.
	stagedAttachmentTTL = 30 * time.Minute
	maxAttachmentName   = 120
)

// allowedAttachmentExt is every extension a comment may carry. No svg, html or executables: the host
// serves attachments back to reviewers.
var allowedAttachmentExt = []string{
	"png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "log", "md", "json", "csv", "yaml", "yml", "xml", "zip", "gz", "diff", "patch",
}

var imageExtType = map[string]string{
	"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
}

// HostViewCompose says what the window's composer may do. Nil when the provider cannot post.
type HostViewCompose struct {
	MaxBodyBytes            int      `json:"maxBodyBytes"`
	ReplyKinds              []string `json:"replyKinds"` // change requests only
	Attachments             bool     `json:"attachments"`
	AttachmentsReason       string   `json:"attachmentsReason,omitempty"`
	MaxAttachments          int      `json:"maxAttachments"`
	MaxAttachmentBytes      int      `json:"maxAttachmentBytes"`
	MaxAttachmentTotalBytes int      `json:"maxAttachmentTotalBytes"`
	AllowedExtensions       []string `json:"allowedExtensions"`
}

func changeRequestCompose(c githost.CommentCapabilities) *HostViewCompose {
	return &HostViewCompose{
		MaxBodyBytes: githost.MaxHostCommentBytes, ReplyKinds: append([]string{}, c.ReplyKinds...),
		Attachments: c.Attachments, AttachmentsReason: c.AttachmentsReason,
		MaxAttachments: githost.MaxAttachments, MaxAttachmentBytes: githost.MaxAttachmentBytes,
		MaxAttachmentTotalBytes: githost.MaxAttachmentTotalBytes, AllowedExtensions: slices.Clone(allowedAttachmentExt),
	}
}

func issueCompose(c issuetracker.CommentCapabilities) *HostViewCompose {
	return &HostViewCompose{
		MaxBodyBytes: issuetracker.MaxCommentBytes, ReplyKinds: []string{},
		Attachments: c.Attachments, AttachmentsReason: c.AttachmentsReason,
		MaxAttachments: githost.MaxAttachments, MaxAttachmentBytes: githost.MaxAttachmentBytes,
		MaxAttachmentTotalBytes: githost.MaxAttachmentTotalBytes, AllowedExtensions: slices.Clone(allowedAttachmentExt),
	}
}

// HostViewStageArgs is StageAttachment's request. Data is the file's bytes, standard base64.
type HostViewStageArgs struct {
	WindowKey string `json:"windowKey"`
	Name      string `json:"name"`
	Data      string `json:"data"`
}

// HostViewStaged is a file held for the next post.
type HostViewStaged struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Size        int    `json:"size"`
	ContentType string `json:"contentType"`
	Image       bool   `json:"image"`
}

// HostViewDiscardArgs is DiscardAttachment's request.
type HostViewDiscardArgs struct {
	WindowKey string `json:"windowKey"`
	ID        string `json:"id"`
}

// HostViewPostArgs is PostComment's request.
type HostViewPostArgs struct {
	WindowKey     string   `json:"windowKey"`
	Body          string   `json:"body"`
	ReplyTo       string   `json:"replyTo"`
	AttachmentIDs []string `json:"attachmentIds"`
}

// HostViewPosted is PostComment's result. Kind unavailable carries Status (change request) or Reason (issue).
type HostViewPosted struct {
	Kind   string          `json:"kind"`
	Status *githost.Status `json:"status,omitempty"`
	Reason string          `json:"reason,omitempty"`
}

type stagedAttachment struct {
	name, contentType string
	data              []byte
	at                time.Time
}

type windowStage struct {
	items   map[string]stagedAttachment
	total   int
	posting bool
}

// HostViewAttachments holds staged files in memory, per window. It is not a service: its methods are
// not bound.
type HostViewAttachments struct {
	mu    sync.Mutex
	byKey map[string]*windowStage
}

var (
	errStageCount = errors.New("too many attachments")
	errStageTotal = errors.New("attachments too large in total")
)

func (h *HostViewAttachments) stage(key string) *windowStage {
	if h.byKey == nil {
		h.byKey = map[string]*windowStage{}
	}
	st := h.byKey[key]
	if st == nil {
		st = &windowStage{items: map[string]stagedAttachment{}}
		h.byKey[key] = st
	}
	return st
}

func (st *windowStage) sweep(now time.Time) {
	for id, a := range st.items {
		if now.Sub(a.at) > stagedAttachmentTTL {
			st.total -= len(a.data)
			delete(st.items, id)
		}
	}
}

// uniqueName keeps names distinct within a window's staged files.
func (st *windowStage) uniqueName(name string) string {
	taken := func(n string) bool {
		for _, a := range st.items {
			if a.name == n {
				return true
			}
		}
		return false
	}
	if !taken(name) {
		return name
	}
	ext := path.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 2; ; i++ {
		if n := fmt.Sprintf("%s-%d%s", stem, i, ext); !taken(n) {
			return n
		}
	}
}

// Put stages a and returns its id and final name.
func (h *HostViewAttachments) Put(key string, a stagedAttachment, now time.Time) (id, name string, err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	st := h.stage(key)
	st.sweep(now)
	switch {
	case len(st.items) >= githost.MaxAttachments:
		return "", "", errStageCount
	case st.total+len(a.data) > githost.MaxAttachmentTotalBytes:
		return "", "", errStageTotal
	}
	a.name, a.at = st.uniqueName(a.name), now
	id = uuid.NewString()
	st.items[id] = a
	st.total += len(a.data)
	return id, a.name, nil
}

// Take returns the staged files for ids without removing them, so a failed post can retry.
// An id past its TTL counts as missing.
func (h *HostViewAttachments) Take(key string, ids []string, now time.Time) ([]githost.Attachment, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	st := h.byKey[key]
	if st != nil {
		st.sweep(now)
	}
	out := make([]githost.Attachment, 0, len(ids))
	for _, id := range ids {
		if st == nil {
			return nil, false
		}
		a, ok := st.items[id]
		if !ok {
			return nil, false
		}
		out = append(out, githost.Attachment{Name: a.name, ContentType: a.contentType, Data: a.data})
	}
	return out, true
}

// Drop removes ids and reports whether any existed.
func (h *HostViewAttachments) Drop(key string, ids ...string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	st := h.byKey[key]
	if st == nil {
		return false
	}
	dropped := false
	for _, id := range ids {
		if a, ok := st.items[id]; ok {
			st.total -= len(a.data)
			delete(st.items, id)
			dropped = true
		}
	}
	return dropped
}

// Forget drops every staged file of key; a window close calls it.
func (h *HostViewAttachments) Forget(key string) {
	h.mu.Lock()
	delete(h.byKey, key)
	h.mu.Unlock()
}

// beginPost reserves key's single post slot.
func (h *HostViewAttachments) beginPost(key string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	st := h.stage(key)
	if st.posting {
		return false
	}
	st.posting = true
	return true
}

func (h *HostViewAttachments) endPost(key string) {
	h.mu.Lock()
	if st := h.byKey[key]; st != nil {
		st.posting = false
	}
	h.mu.Unlock()
}

// SanitizeAttachmentName makes a file name a safe label: no path, no control or reserved characters,
// no hidden file, an extension, at most 120 bytes. Go never opens a path; names are labels only.
func SanitizeAttachmentName(raw string) (string, bool) {
	raw = path.Base(strings.ReplaceAll(raw, `\`, "/"))
	var b strings.Builder
	for _, r := range raw {
		if unicode.IsControl(r) || strings.ContainsRune(`/\:*?"<>|`, r) || r == utf8.RuneError {
			continue
		}
		b.WriteRune(r)
	}
	name := strings.TrimSpace(b.String())
	if name == "" || strings.HasPrefix(name, ".") {
		return "", false
	}
	name = strings.TrimRight(name, " .")
	ext := path.Ext(name)
	if ext == "" {
		return "", false
	}
	if len(name) > maxAttachmentName {
		stem := strings.TrimSuffix(name, ext)
		cut := min(len(stem), max(maxAttachmentName-len(ext), 1))
		for cut > 0 && cut < len(stem) && !utf8.RuneStart(stem[cut]) {
			cut--
		}
		if cut == 0 {
			return "", false
		}
		name = stem[:cut] + ext
	}
	return name, true
}

// composeTarget is the window's resolved write role.
type composeTarget struct {
	target  *HostViewTarget
	compose *HostViewCompose
	cr      githost.ChangeRequestComments
	crLink  hostViewLink
	issue   issuetracker.IssueComments
	ref     issuetracker.Ref
}

func (s *HostViewService) noWindow() error {
	return composeRefusal(composeKeyNoWindow, nil)
}

const (
	composeKeyBadReply            = "backend.space.hostView.compose.badReply.body"
	composeKeyBadText             = "backend.space.hostView.compose.badText.body"
	composeKeyDuplicateAttachment = "backend.space.hostView.compose.duplicateAttachment.body"
	composeKeyEmpty               = "backend.space.hostView.compose.empty.body"
	composeKeyFileContent         = "backend.space.hostView.compose.fileContent.body"
	composeKeyFileEmpty           = "backend.space.hostView.compose.fileEmpty.body"
	composeKeyFileName            = "backend.space.hostView.compose.fileName.body"
	composeKeyFileTooLarge        = "backend.space.hostView.compose.fileTooLarge.body"
	composeKeyFileType            = "backend.space.hostView.compose.fileType.body"
	composeKeyLimitCount          = "backend.space.hostView.compose.limitCount.body"
	composeKeyLimitTotal          = "backend.space.hostView.compose.limitTotal.body"
	composeKeyPosting             = "backend.space.hostView.compose.posting.body"
	composeKeyReplyUnsupported    = "backend.space.hostView.compose.replyUnsupported.body"
	composeKeyTooLong             = "backend.space.hostView.compose.tooLong.body"
	composeKeyUnknownAttachment   = "backend.space.hostView.compose.unknownAttachment.body"
)

const composeKeyNoWindow = "backend.space.hostView.compose.noWindow.body"

func composeRefusal(key string, params map[string]string) error {
	return ipcerr.T(ipcerr.CodeBadRequest, key, params)
}

// resolveCompose finds what window key may post to. The target comes from the window, never the caller.
func (s *HostViewService) resolveCompose(ctx context.Context, key string) (composeTarget, error) {
	if err := validateAdeItemID(key, "windowKey"); err != nil {
		return composeTarget{}, err
	}
	if s.Targets == nil || s.Attachments == nil {
		return composeTarget{}, s.noWindow()
	}
	t := s.Targets.Get(key)
	if t == nil {
		return composeTarget{}, s.noWindow()
	}
	ct := composeTarget{target: t}
	switch t.Kind {
	case HostViewKindChangeRequest:
		l, err := s.parse(ctx, t.URL)
		if err != nil {
			return composeTarget{}, s.noWindow()
		}
		w, ok := l.p.(githost.ChangeRequestComments)
		if !ok {
			return composeTarget{}, s.noWindow()
		}
		ct.cr, ct.crLink, ct.compose = w, l, changeRequestCompose(w.CommentCapabilities(l.repo))
	case HostViewKindIssue:
		raw := t.URL
		if raw == "" {
			raw = t.Key
		}
		p, ref, ok := s.issueProvider(raw)
		if !ok {
			return composeTarget{}, s.noWindow()
		}
		w, ok := p.(issuetracker.IssueComments)
		if !ok {
			return composeTarget{}, s.noWindow()
		}
		ct.issue, ct.ref, ct.compose = w, ref, issueCompose(w.CommentCapabilities())
	default:
		return composeTarget{}, s.noWindow()
	}
	return ct, nil
}

func megabytes(n int) string { return fmt.Sprintf("%d MB", n>>20) }

// StageAttachment holds a file for the window's next post. Limits are enforced here, before any
// bytes reach a host.
func (s *HostViewService) StageAttachment(ctx context.Context, args HostViewStageArgs) (HostViewStaged, error) {
	ct, err := s.resolveCompose(ctx, args.WindowKey)
	if err != nil {
		return HostViewStaged{}, err
	}
	if !ct.compose.Attachments {
		return HostViewStaged{}, ipcerr.BadRequest(ct.compose.AttachmentsReason)
	}
	if len(args.Data) > base64.StdEncoding.EncodedLen(githost.MaxAttachmentBytes) {
		return HostViewStaged{}, composeRefusal(composeKeyFileTooLarge, map[string]string{"max": megabytes(githost.MaxAttachmentBytes)})
	}
	data, err := base64.StdEncoding.DecodeString(args.Data)
	if err != nil {
		return HostViewStaged{}, ipcerr.Contract("data must be base64")
	}
	switch {
	case len(data) == 0:
		return HostViewStaged{}, composeRefusal(composeKeyFileEmpty, nil)
	case len(data) > githost.MaxAttachmentBytes:
		return HostViewStaged{}, composeRefusal(composeKeyFileTooLarge, map[string]string{"max": megabytes(githost.MaxAttachmentBytes)})
	}
	name, ok := SanitizeAttachmentName(args.Name)
	if !ok {
		return HostViewStaged{}, composeRefusal(composeKeyFileName, nil)
	}
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(name), "."))
	if !slices.Contains(allowedAttachmentExt, ext) {
		return HostViewStaged{}, composeRefusal(composeKeyFileType, map[string]string{"ext": ext})
	}
	sniffed, _, _ := mime.ParseMediaType(http.DetectContentType(data))
	if want, isImage := imageExtType[ext]; (isImage && sniffed != want) || sniffed == "text/html" {
		return HostViewStaged{}, composeRefusal(composeKeyFileContent, map[string]string{"ext": ext})
	}
	id, final, err := s.Attachments.Put(args.WindowKey, stagedAttachment{name: name, contentType: sniffed, data: data}, s.now())
	switch {
	case errors.Is(err, errStageCount):
		return HostViewStaged{}, composeRefusal(composeKeyLimitCount, map[string]string{"max": fmt.Sprint(githost.MaxAttachments)})
	case errors.Is(err, errStageTotal):
		return HostViewStaged{}, composeRefusal(composeKeyLimitTotal, map[string]string{"max": megabytes(githost.MaxAttachmentTotalBytes)})
	case err != nil:
		return HostViewStaged{}, ipcerr.InternalErr(err)
	}
	return HostViewStaged{ID: id, Name: final, Size: len(data), ContentType: sniffed, Image: isImageType(sniffed)}, nil
}

func isImageType(contentType string) bool {
	for _, t := range imageExtType {
		if t == contentType {
			return true
		}
	}
	return false
}

// DiscardAttachment drops a staged file and reports whether it existed.
func (s *HostViewService) DiscardAttachment(_ context.Context, args HostViewDiscardArgs) (bool, error) {
	if err := validateAdeItemID(args.WindowKey, "windowKey"); err != nil {
		return false, err
	}
	if s.Attachments == nil {
		return false, nil
	}
	return s.Attachments.Drop(args.WindowKey, args.ID), nil
}

// PostComment posts to the window's own change request or issue. A host failure is data (Kind), not
// an error. A failed post keeps the staged files, so Retry re-sends them.
func (s *HostViewService) PostComment(ctx context.Context, args HostViewPostArgs) (HostViewPosted, error) {
	ct, err := s.resolveCompose(ctx, args.WindowKey)
	if err != nil {
		return HostViewPosted{}, err
	}
	if err := s.validatePost(ct, args); err != nil {
		return HostViewPosted{}, err
	}
	if !s.Attachments.beginPost(args.WindowKey) {
		return HostViewPosted{}, composeRefusal(composeKeyPosting, nil)
	}
	defer s.Attachments.endPost(args.WindowKey)
	files, ok := s.Attachments.Take(args.WindowKey, args.AttachmentIDs, s.now())
	if !ok {
		return HostViewPosted{}, composeRefusal(composeKeyUnknownAttachment, nil)
	}
	var res HostViewPosted
	if ct.cr != nil {
		res = s.postChangeRequest(ctx, ct, githost.NewComment{Body: args.Body, ReplyTo: args.ReplyTo, Attachments: files})
	} else {
		res = s.postIssue(ctx, ct, args.Body)
	}
	if res.Kind == HostViewOK {
		s.Attachments.Drop(args.WindowKey, args.AttachmentIDs...)
	}
	return res, nil
}

func (s *HostViewService) validatePost(ct composeTarget, a HostViewPostArgs) error {
	switch {
	case strings.TrimSpace(a.Body) == "" && len(a.AttachmentIDs) == 0:
		return composeRefusal(composeKeyEmpty, nil)
	case len(a.Body) > ct.compose.MaxBodyBytes:
		return composeRefusal(composeKeyTooLong, map[string]string{"max": fmt.Sprintf("%d KB", ct.compose.MaxBodyBytes>>10)})
	case !utf8.ValidString(a.Body) || strings.ContainsRune(a.Body, 0):
		return composeRefusal(composeKeyBadText, nil)
	case len(a.ReplyTo) > maxReplyToBytes:
		return composeRefusal(composeKeyBadReply, nil)
	case a.ReplyTo != "" && ct.cr == nil:
		return composeRefusal(composeKeyReplyUnsupported, nil)
	case len(a.AttachmentIDs) > githost.MaxAttachments:
		return composeRefusal(composeKeyLimitCount, map[string]string{"max": fmt.Sprint(githost.MaxAttachments)})
	case len(a.AttachmentIDs) > 0 && !ct.compose.Attachments:
		return ipcerr.BadRequest(ct.compose.AttachmentsReason)
	}
	seen := map[string]bool{}
	for _, id := range a.AttachmentIDs {
		if seen[id] {
			return composeRefusal(composeKeyDuplicateAttachment, nil)
		}
		seen[id] = true
	}
	return nil
}

func (s *HostViewService) postChangeRequest(ctx context.Context, ct composeTarget, c githost.NewComment) HostViewPosted {
	key := ct.crLink.repoIdentity()
	if st, armed := s.breaker.armed(key, s.now()); armed {
		return HostViewPosted{Kind: HostViewUnavailable, Status: &st}
	}
	st := ct.cr.PostChangeRequestComment(ctx, ct.crLink.repo, ct.crLink.number, c)
	switch {
	case ctx.Err() != nil:
		return HostViewPosted{Kind: HostViewUnavailable, Status: &githost.Status{Kind: githost.KindNotFound, Reason: "cancelled"}}
	case st.OK():
		return HostViewPosted{Kind: HostViewOK}
	case st.Gone:
		return HostViewPosted{Kind: HostViewGone, Status: &st}
	case st.RateLimited:
		until := st.ResetAt
		if until.IsZero() {
			until = s.now().Add(hostViewBreakerFallback)
		}
		s.breaker.arm(key, until, st)
	}
	return HostViewPosted{Kind: HostViewUnavailable, Status: &st}
}

func (s *HostViewService) postIssue(ctx context.Context, ct composeTarget, body string) HostViewPosted {
	err := ct.issue.PostIssueComment(ctx, ct.ref, body)
	switch {
	case err == nil:
		return HostViewPosted{Kind: HostViewOK}
	case errors.Is(err, issuetracker.ErrNotFound):
		return HostViewPosted{Kind: HostViewGone, Reason: issuetracker.ReasonNotFound}
	case ctx.Err() != nil:
		return HostViewPosted{Kind: HostViewUnavailable, Reason: issuetracker.ReasonTimeout}
	}
	return HostViewPosted{Kind: HostViewUnavailable, Reason: issuetracker.Reason(err)}
}
