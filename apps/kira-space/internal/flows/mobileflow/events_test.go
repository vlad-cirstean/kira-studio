package mobileflow_test

import (
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
)

// next returns the next frame of any event.
func (s *sse) next(t *testing.T) sseFrame {
	t.Helper()
	select {
	case f := <-s.frames:
		return f
	case <-s.closed:
		t.Fatal("event stream closed")
	case <-time.After(waitFor):
		t.Fatal("no event within the wait")
	}
	return sseFrame{}
}

func TestPhoneEventStream(t *testing.T) {
	f := newFixture(t)
	app := f.app
	p, _ := pairedPhone(t, f)
	stream := p.events()

	// A desktop-only change is not forwarded; the ADE change that follows is.
	if _, err := app.W.Mobile.SetAgentInputEnabled(bridge.MobileSetAgentInputArgs{Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.W.AdeTask.AddBacklogItem(ctx, adewire.AddBacklogItemArgs{Text: "Seen on the phone"}); err != nil {
		t.Fatal(err)
	}
	var backlog sseFrame
	for {
		fr := stream.next(t)
		if strings.HasPrefix(fr.Event, "kira:mobile:") || fr.Event == "kira:settings:changed" {
			t.Fatalf("desktop-only event %q reached the phone", fr.Event)
		}
		if fr.Event == adewire.ChannelBacklog {
			backlog = fr
			break
		}
	}
	// The backlog event is a signal; the phone refetches.
	if r := p.get("/api/ade/backlog"); !strings.Contains(string(r.Body), "Seen on the phone") {
		t.Fatalf("backlog after the %q event = %s", backlog.Event, r.Body)
	}

	if _, err := app.W.AdeTask.StageDone(ctx, adewire.TaskArgs{TaskID: f.task.ID}); err != nil {
		t.Fatal(err)
	}
	stream.wait(t, adewire.ChannelBoard, waitFor)
	var board adewire.Board
	p.get("/api/ade/board").json(t, &board)
	var stage string
	for _, tk := range board.Tasks {
		if tk.ID == f.task.ID {
			stage = tk.StageID
		}
	}
	if stage != "done" {
		t.Fatalf("board after the event shows task stage %q, want done", stage)
	}
}
