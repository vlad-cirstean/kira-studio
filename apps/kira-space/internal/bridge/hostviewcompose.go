package bridge

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/issuetracker"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

const maxReplyToBytes = 256

// HostViewCompose says what the window's composer may do. Nil when the provider cannot post.
type HostViewCompose struct {
	MaxBodyBytes int      `json:"maxBodyBytes"`
	ReplyKinds   []string `json:"replyKinds"` // change requests only
}

func changeRequestCompose(replyKinds []string) *HostViewCompose {
	return &HostViewCompose{MaxBodyBytes: githost.MaxHostCommentBytes, ReplyKinds: append([]string{}, replyKinds...)}
}

func issueCompose() *HostViewCompose {
	return &HostViewCompose{MaxBodyBytes: issuetracker.MaxCommentBytes, ReplyKinds: []string{}}
}

// HostViewPostArgs is PostComment's request.
type HostViewPostArgs struct {
	WindowKey string `json:"windowKey"`
	Body      string `json:"body"`
	ReplyTo   string `json:"replyTo"`
}

// HostViewPosted is PostComment's result. Kind unavailable carries Status (change request) or Reason (issue).
type HostViewPosted struct {
	Kind   string          `json:"kind"`
	Status *githost.Status `json:"status,omitempty"`
	Reason string          `json:"reason,omitempty"`
}

// beginPost reserves key's single post slot.
func (s *HostViewService) beginPost(key string) bool {
	s.postMu.Lock()
	defer s.postMu.Unlock()
	if s.posting[key] {
		return false
	}
	if s.posting == nil {
		s.posting = map[string]bool{}
	}
	s.posting[key] = true
	return true
}

func (s *HostViewService) endPost(key string) {
	s.postMu.Lock()
	delete(s.posting, key)
	s.postMu.Unlock()
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
	composeKeyBadReply         = "backend.space.hostView.compose.badReply.body"
	composeKeyBadText          = "backend.space.hostView.compose.badText.body"
	composeKeyEmpty            = "backend.space.hostView.compose.empty.body"
	composeKeyPosting          = "backend.space.hostView.compose.posting.body"
	composeKeyReplyUnsupported = "backend.space.hostView.compose.replyUnsupported.body"
	composeKeyTooLong          = "backend.space.hostView.compose.tooLong.body"
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
	if s.Targets == nil {
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
		ct.cr, ct.crLink, ct.compose = w, l, changeRequestCompose(w.ReplyKinds(l.repo))
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
		ct.issue, ct.ref, ct.compose = w, ref, issueCompose()
	default:
		return composeTarget{}, s.noWindow()
	}
	return ct, nil
}

// PostComment posts to the window's own change request or issue. A host failure is data (Kind), not
// an error.
func (s *HostViewService) PostComment(ctx context.Context, args HostViewPostArgs) (HostViewPosted, error) {
	ct, err := s.resolveCompose(ctx, args.WindowKey)
	if err != nil {
		return HostViewPosted{}, err
	}
	if err := s.validatePost(ct, args); err != nil {
		return HostViewPosted{}, err
	}
	if !s.beginPost(args.WindowKey) {
		return HostViewPosted{}, composeRefusal(composeKeyPosting, nil)
	}
	defer s.endPost(args.WindowKey)
	var res HostViewPosted
	if ct.cr != nil {
		res = s.postChangeRequest(ctx, ct, githost.NewComment{Body: args.Body, ReplyTo: args.ReplyTo})
	} else {
		res = s.postIssue(ctx, ct, args.Body)
	}
	return res, nil
}

func (s *HostViewService) validatePost(ct composeTarget, a HostViewPostArgs) error {
	switch {
	case strings.TrimSpace(a.Body) == "":
		return composeRefusal(composeKeyEmpty, nil)
	case len(a.Body) > ct.compose.MaxBodyBytes:
		return composeRefusal(composeKeyTooLong, map[string]string{"max": fmt.Sprintf("%d KB", ct.compose.MaxBodyBytes>>10)})
	case !utf8.ValidString(a.Body) || strings.ContainsRune(a.Body, 0):
		return composeRefusal(composeKeyBadText, nil)
	case len(a.ReplyTo) > maxReplyToBytes:
		return composeRefusal(composeKeyBadReply, nil)
	case a.ReplyTo != "" && ct.cr == nil:
		return composeRefusal(composeKeyReplyUnsupported, nil)
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
