package mobileflow_test

import (
	"net/http"
	"slices"
	"sync"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
)

// The phone and the desktop reorder the same Backlog shelf at once: the result is one of the two
// serial orders, never a lost or doubled task.
func TestPhoneAndDesktopWriteRace(t *testing.T) {
	f := newFixture(t)
	app := f.app
	p, deviceID := pairedPhone(t, f)
	if err := app.W.Mobile.SetDevicePermissions(bridge.MobileDevicePermissionsArgs{ID: deviceID, Write: true}); err != nil {
		t.Fatal(err)
	}
	names := []string{"a", "b", "c", "d"}
	ids := map[string]string{}
	for _, title := range names {
		tk, err := app.W.AdeTask.CaptureTask(ctx, adewire.CaptureTaskArgs{Title: title})
		if err != nil {
			t.Fatal(err)
		}
		if err := app.W.AdeTask.ShelveTask(ctx, adewire.ShelveTaskArgs{TaskID: tk.ID, Shelf: adewire.ShelfBacklog}); err != nil {
			t.Fatal(err)
		}
		ids[title] = tk.ID
	}

	for round := range 10 {
		before := shelfTitles(t, app, adewire.ShelfBacklog, names...)
		var wg sync.WaitGroup
		var phoneStatus int
		var desktopErr error
		wg.Add(2)
		go func() {
			defer wg.Done()
			phoneStatus = p.post("/api/ade/shelf/move", map[string]string{"taskId": ids["a"], "shelf": adewire.ShelfBacklog, "beforeId": ""}).Status
		}()
		go func() {
			defer wg.Done()
			desktopErr = app.W.AdeTask.ShelveTask(ctx, adewire.ShelveTaskArgs{TaskID: ids["d"], Shelf: adewire.ShelfBacklog, BeforeID: ids["b"]})
		}()
		wg.Wait()
		if phoneStatus != http.StatusOK || desktopErr != nil {
			t.Fatalf("round %d: phone %d, desktop %v", round, phoneStatus, desktopErr)
		}
		got := shelfTitles(t, app, adewire.ShelfBacklog, names...)
		sorted := slices.Sorted(slices.Values(got))
		if !slices.Equal(sorted, names) {
			t.Fatalf("round %d: Backlog %v lost or doubled a task", round, got)
		}
		phoneFirst := serial(before, "a", "", "d", "b")
		desktopFirst := serial(before, "d", "b", "a", "")
		if !slices.Equal(got, phoneFirst) && !slices.Equal(got, desktopFirst) {
			t.Fatalf("round %d: Backlog %v after %v, want %v or %v", round, got, before, phoneFirst, desktopFirst)
		}
	}
}

// serial applies two shelf moves in order: each puts a title right before another, or last.
func serial(start []string, firstTitle, firstBefore, secondTitle, secondBefore string) []string {
	out := slices.Clone(start)
	move := func(title, before string) {
		out = slices.Delete(out, slices.Index(out, title), slices.Index(out, title)+1)
		if before == "" {
			out = append(out, title)
			return
		}
		out = slices.Insert(out, slices.Index(out, before), title)
	}
	move(firstTitle, firstBefore)
	move(secondTitle, secondBefore)
	return out
}

// A paired phone stays paired across a relaunch.
func TestPairedDeviceSurvivesRestart(t *testing.T) {
	f := newFixture(t)
	app := f.app
	_, deviceID := pairedPhone(t, f)
	before, err := app.W.Mobile.Devices()
	if err != nil || len(before) != 1 || before[0].ID != deviceID {
		t.Fatalf("Devices = %+v, %v", before, err)
	}
	app.Restart()
	after, err := app.W.Mobile.Devices()
	if err != nil || len(after) != 1 || after[0].ID != deviceID || after[0].Label != before[0].Label {
		t.Fatalf("Devices after restart = %+v, %v, want %+v", after, err, before)
	}
}
