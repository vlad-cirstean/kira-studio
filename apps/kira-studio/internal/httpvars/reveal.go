package httpvars

import (
	"fmt"
	"log/slog"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/localauth"
)

// revealReason mirrors connections.revealReason — LAContext.evaluatePolicy's localizedReason
// (P14 D11; macOS prefixes it with "Kira Studio wants to").
const revealReason = "reveal a saved variable value."

// The same four-outcome vocabulary connections.RevealResult already established (D8), redeclared
// rather than imported — see the package doc for why.
const (
	OutcomeRevealed             = "revealed"
	OutcomeCancelled            = "cancelled"
	OutcomeConfirmationRequired = "confirmation-required"
	OutcomeError                = "error"
)

// RevealResult never carries a value except on OutcomeRevealed.
type RevealResult struct {
	Value   *string `json:"value"`
	Error   *string `json:"error"`
	Outcome string  `json:"outcome"`
}

// Reveal never errors (P25 D9's contract, inherited via P14): an undecryptable secret, a declined
// prompt, or a required confirmation all come back as a RevealResult naming its own Outcome, not a
// rejected call. Gated through the SAME *localauth.Authorizer instance connections.Service.Reveal
// uses (D8) — a grace granted by either reveal covers the other.
func (s *Service) Reveal(variableID string, confirmed bool) RevealResult {
	if variableID == "" {
		msg := "variableId is required"
		return RevealResult{Outcome: OutcomeError, Error: &msg}
	}
	return s.reveal(revealReason, variableID, confirmed, s.deps.Repo.RevealValue, "variable")
}

// RevealHistory is Reveal's sibling over http_variable_history (D13) — a secret's old value is
// exactly as sensitive as its current one, so it goes through the same gate.
func (s *Service) RevealHistory(historyID string, confirmed bool) RevealResult {
	if historyID == "" {
		msg := "historyId is required"
		return RevealResult{Outcome: OutcomeError, Error: &msg}
	}
	return s.reveal(revealReason, historyID, confirmed, s.deps.Repo.RevealHistoryValue, "variable history entry")
}

func (s *Service) reveal(reason, id string, confirmed bool, decrypt func(string) (string, error), subject string) RevealResult {
	outcome, err := s.deps.Auth.Authorize(reason, confirmed)
	if err != nil {
		msg := err.Error()
		slog.Warn(fmt.Sprintf("local authentication errored before revealing a %s (%s): %s", subject, id, msg), "scope", "httpvars")
		return RevealResult{Outcome: OutcomeError, Error: &msg}
	}
	switch outcome {
	case localauth.Cancelled:
		// D11 (inherited via P14): the user cancelled on purpose — no message, that would nag.
		return RevealResult{Outcome: OutcomeCancelled}
	case localauth.Unavailable:
		return RevealResult{Outcome: OutcomeConfirmationRequired}
	}

	value, err := decrypt(id)
	if err != nil {
		msg := err.Error()
		slog.Warn(fmt.Sprintf("reveal failed for a %s (%s): %s", subject, id, msg), "scope", "httpvars")
		return RevealResult{Outcome: OutcomeError, Error: &msg}
	}
	// D5: the subject, never the value — connections.Service.Reveal's own precedent.
	slog.Info(fmt.Sprintf("%s revealed for %s", subject, id), "scope", "httpvars")
	return RevealResult{Outcome: OutcomeRevealed, Value: &value}
}
