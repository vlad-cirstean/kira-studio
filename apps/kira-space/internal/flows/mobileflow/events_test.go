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
	if _, err := app.W.AdeTask.CaptureTask(ctx, adewire.CaptureTaskArgs{Title: "Seen on the phone"}); err != nil {
		t.Fatal(err)
	}
	for {
		fr := stream.next(t)
		if strings.HasPrefix(fr.Event, "kira:mobile:") || fr.Event == "kira:settings:changed" {
			t.Fatalf("desktop-only event %q reached the phone", fr.Event)
		}
		if fr.Event == adewire.ChannelBoard {
			break
		}
	}
	// The board event is a signal; the phone refetches.
	if r := p.get("/api/ade/board"); !strings.Contains(string(r.Body), "Seen on the phone") {
		t.Fatalf("board after the event = %s", r.Body)
	}

	if _, err := app.W.AdeTask.StepDone(ctx, adewire.TaskArgs{TaskID: f.task.ID}); err != nil {
		t.Fatal(err)
	}
	stream.wait(t, adewire.ChannelBoard, waitFor)
	var board adewire.Board
	p.get("/api/ade/board").json(t, &board)
	var entry string
	for _, tk := range board.Tasks {
		if tk.ID == f.task.ID {
			entry = tk.EntryStepID
		}
	}
	if entry != "done" {
		t.Fatalf("board after the event shows task entry %q, want done", entry)
	}
}
