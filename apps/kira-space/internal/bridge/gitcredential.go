package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitcred"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// GitCredentialRelay is the one seam this service needs from internal/gitcred.
type GitCredentialRelay interface {
	Pending() gitcred.Snapshot
	Provide(requestID string, secret *string) bool
	Subscribe(fn func(gitcred.Snapshot)) (unsubscribe func())
}

// GitCredentialService answers the credential prompts git raised for a socket client or the ADE
// board — operations with no window of their own, so Kira Space shows them (P178 D3).
type GitCredentialService struct {
	Deps  appcore.Deps
	Relay GitCredentialRelay
}

// GitCredentialPrompt is gitcred.Prompt's wire projection.
type GitCredentialPrompt struct {
	RequestID string `json:"requestId"`
	Source    string `json:"source"`
	RepoLabel string `json:"repoLabel"`
	Prompt    string `json:"prompt"`
	Masked    bool   `json:"masked"`
}

func toWirePrompts(snap gitcred.Snapshot) []GitCredentialPrompt {
	out := make([]GitCredentialPrompt, 0, len(snap))
	for _, p := range snap {
		out = append(out, GitCredentialPrompt{
			RequestID: p.RequestID, Source: p.Source, RepoLabel: p.RepoLabel, Prompt: p.Prompt, Masked: p.Masked,
		})
	}
	return out
}

func (s *GitCredentialService) Pending() []GitCredentialPrompt {
	return toWirePrompts(s.Relay.Pending())
}

// GitCredentialProvideArgs: a nil Secret dismisses the prompt.
type GitCredentialProvideArgs struct {
	RequestID string  `json:"requestId"`
	Secret    *string `json:"secret"`
}

// Provide reports whether the prompt was still waiting; a stale or repeated answer is false, never
// an error.
func (s *GitCredentialService) Provide(args GitCredentialProvideArgs) (bool, error) {
	if args.RequestID == "" {
		return false, ipcerr.BadRequest("requestId is required")
	}
	return s.Relay.Provide(args.RequestID, args.Secret), nil
}

// AttachGitCredentialPush broadcasts every relay change on ChannelGitCredential. Call once at startup; the
// returned unsubscribe runs in teardown.
func AttachGitCredentialPush(s *GitCredentialService) (unsubscribe func()) {
	return s.Relay.Subscribe(func(snap gitcred.Snapshot) {
		s.Deps.Events.Emit(ChannelGitCredential, toWirePrompts(snap))
	})
}
