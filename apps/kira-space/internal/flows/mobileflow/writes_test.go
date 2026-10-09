package mobileflow_test

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/testx"
)

func backlogTexts(t *testing.T, app *flowharness.App) []string {
	t.Helper()
	res, err := app.W.AdeTask.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	out := make([]string, len(res.Items))
	for i, it := range res.Items {
		out[i] = it.Text
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestPhoneWrites(t *testing.T) {
	f := newFixture(t)
	app := f.app
	p, deviceID := pairedPhone(t, f)
	setPerms := func(write bool) {
		t.Helper()
		if err := app.W.Mobile.SetDevicePermissions(bridge.MobileDevicePermissionsArgs{ID: deviceID, Write: write}); err != nil {
			t.Fatal(err)
		}
	}

	setPerms(false)
	r := p.post("/api/ade/backlog/items", map[string]string{"text": "refused"})
	if r.Status != http.StatusForbidden || r.code(t) != "E_WRITE_OFF" {
		t.Fatalf("write without permission = %d %s", r.Status, r.Body)
	}
	if got := backlogTexts(t, app); len(got) != 0 {
		t.Fatalf("a refused write changed the backlog: %v", got)
	}

	setPerms(true)
	if r := p.send(http.MethodPost, "/api/ade/backlog/items", map[string]string{"text": "x"}, ""); r.Status != http.StatusBadRequest || r.code(t) != "E_IDEMPOTENCY_KEY" {
		t.Fatalf("write without an Idempotency-Key = %d %s", r.Status, r.Body)
	}
	key := uuid.NewString()
	first := p.send(http.MethodPost, "/api/ade/backlog/items", map[string]string{"text": "first"}, key)
	if first.Status != http.StatusOK {
		t.Fatalf("backlog add = %d %s", first.Status, first.Body)
	}
	replay := p.send(http.MethodPost, "/api/ade/backlog/items", map[string]string{"text": "first"}, key)
	if replay.Status != http.StatusOK || replay.Header.Get("Idempotent-Replay") != "true" || !bytes.Equal(replay.Body, first.Body) {
		t.Fatalf("replay = %d %q (replay header %q), want the first response again", replay.Status, replay.Body, replay.Header.Get("Idempotent-Replay"))
	}
	if got := backlogTexts(t, app); !equal(got, []string{"first"}) {
		t.Fatalf("backlog after a replayed add = %v, want one item", got)
	}
	var second adewire.BacklogItem
	r = p.post("/api/ade/backlog/items", map[string]string{"text": "second"})
	r.json(t, &second)
	if got := backlogTexts(t, app); !equal(got, []string{"second", "first"}) {
		t.Fatalf("backlog = %v, want the newest first", got)
	}
	if r := p.post("/api/ade/backlog/move", map[string]any{"id": second.ID, "toIndex": 1}); r.Status != http.StatusOK {
		t.Fatalf("backlog move = %d %s", r.Status, r.Body)
	}
	if got := backlogTexts(t, app); !equal(got, []string{"first", "second"}) {
		t.Fatalf("backlog after move = %v, want first second", got)
	}

	// The task sits in its review stage; prev and next walk it through the workflow.
	if got := f.taskNow(t).StageID; got != "review" {
		t.Fatalf("task stage = %q, want review", got)
	}
	if r := p.post("/api/ade/tasks/stage", map[string]string{"taskId": f.task.ID, "stageId": "build"}); r.Status != http.StatusBadRequest {
		t.Fatalf("stage move without fromStageId = %d %s, want 400", r.Status, r.Body)
	}
	if r := p.post("/api/ade/tasks/stage", map[string]string{"taskId": f.task.ID, "stageId": "review", "fromStageId": "build"}); r.Status == http.StatusOK {
		t.Fatalf("stage move from a stale stage succeeded: %s", r.Body)
	}
	for _, step := range []struct{ from, to string }{{"review", "build"}, {"build", "review"}} {
		r := p.post("/api/ade/tasks/stage", map[string]string{"taskId": f.task.ID, "stageId": step.to, "fromStageId": step.from})
		if r.Status != http.StatusOK {
			t.Fatalf("stage %s to %s = %d %s", step.from, step.to, r.Status, r.Body)
		}
		if got := f.taskNow(t).StageID; got != step.to {
			t.Fatalf("task stage = %q, want %q", got, step.to)
		}
	}

	// A launch asks the desktop window to open the terminal and waits for its answer.
	mark := app.Events.Mark()
	launched := make(chan bridge.MobileOpenLaunchEvent, 1)
	go func() {
		ev := app.Events.WaitAfter(t, mark, bridge.ChannelMobileOpenLaunch, nil, waitFor)
		var open bridge.MobileOpenLaunchEvent
		ev.Decode(t, &open)
		if ev.Window != desktopWindow {
			t.Errorf("open-launch sent to %q, want %s", ev.Window, desktopWindow)
		}
		f.openLaunch(t, open.Launch)
		if err := app.W.Mobile.LaunchOpened(bridge.MobileLaunchOpenedArgs{TerminalID: open.Launch.TerminalID}); err != nil {
			t.Errorf("LaunchOpened: %v", err)
		}
		launched <- open
	}()
	r = p.post("/api/ade/tasks/launch", map[string]string{"taskId": f.task.ID, "fromStageId": "review"})
	if r.Status != http.StatusOK {
		t.Fatalf("launch = %d %s", r.Status, r.Body)
	}
	open := <-launched
	var res struct {
		SessionID string `json:"sessionId"`
	}
	r.json(t, &res)
	if res.SessionID == "" || res.SessionID != open.Launch.SessionID || open.TaskID != f.task.ID {
		t.Fatalf("launch result %+v for event %+v", res, open)
	}
	testx.WaitUntil(t, waitFor, func() bool {
		sessions, _ := app.W.AdeTask.Sessions(ctx)
		for _, s := range sessions.Sessions {
			if s.ID == res.SessionID {
				return s.State == "running" && s.TerminalID == open.Launch.TerminalID
			}
		}
		return false
	})
	f.release(t)
}
