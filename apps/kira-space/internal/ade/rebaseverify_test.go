package ade

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/adeagent"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/runoutcome"
)

func TestDecideRebaseOutcome(t *testing.T) {
	clean := rebaseCheck{facts: model.RebaseFacts{Verified: true}}
	broken := rebaseCheck{facts: model.RebaseFacts{InProgress: true}, failure: "a rebase is still in progress in /wt/a"}
	failedEnd := fromOutcome(model.AdeRunFailed, runoutcome.ForProcess(runoutcome.Process{Kind: runoutcome.KindAgent}))
	crashEnd := fromOutcome(model.AdeRunFailed, runoutcome.ForProcess(runoutcome.Process{Kind: runoutcome.KindAgent, ExitCode: 1}))
	stoppedEnd := fromOutcome(model.AdeRunStuck, runoutcome.Outcome{Status: runoutcome.StatusCancelled, Source: runoutcome.SourceUser, Reason: "stopped by you"})
	fin := func(status string) *adeagent.Finish {
		return &adeagent.Finish{Status: status, Summary: "s", Reason: "because"}
	}
	cases := []struct {
		name       string
		f          *adeagent.Finish
		chk        rebaseCheck
		end        outcome
		wantState  string
		wantStatus runoutcome.Status
		wantSource runoutcome.Source
		wantReason string
	}{
		{"done and verified", fin("done"), clean, failedEnd, model.AdeRunDone, runoutcome.StatusDone, runoutcome.SourceAgent, ""},
		{"done but git disagrees", fin("done"), broken, failedEnd, model.AdeRunFailed, runoutcome.StatusFailed, runoutcome.SourceVerify, "verification failed: a rebase is still in progress in /wt/a"},
		{"failed keeps the agent reason", fin("failed"), broken, failedEnd, model.AdeRunFailed, runoutcome.StatusFailed, runoutcome.SourceAgent, "because"},
		{"needs input blocks", fin("needs_input"), broken, failedEnd, model.AdeRunStuck, runoutcome.StatusBlocked, runoutcome.SourceAgent, "because"},
		{"no report keeps the process end", nil, clean, failedEnd, model.AdeRunFailed, runoutcome.StatusFailed, runoutcome.SourceExit, "no report: Claude ended without calling finish_step"},
		{"crash", nil, broken, crashEnd, model.AdeRunFailed, runoutcome.StatusFailed, runoutcome.SourceExit, "no report: claude exited with status 1"},
		{"stop", nil, broken, stoppedEnd, model.AdeRunStuck, runoutcome.StatusCancelled, runoutcome.SourceUser, "stopped by you"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := decideRebaseOutcome(c.f, c.chk, c.end)
			if got.state != c.wantState || got.out.Status != c.wantStatus || got.out.Source != c.wantSource || got.out.Reason != c.wantReason {
				t.Fatalf("got state=%s status=%s source=%s reason=%q", got.state, got.out.Status, got.out.Source, got.out.Reason)
			}
			if got.out.Rebase == nil || got.out.Rebase.Verified != c.chk.facts.Verified {
				t.Fatalf("facts not attached or changed: %+v", got.out.Rebase)
			}
			if c.f != nil && got.out.Reported != true {
				t.Fatal("a report must be marked reported")
			}
		})
	}
}
