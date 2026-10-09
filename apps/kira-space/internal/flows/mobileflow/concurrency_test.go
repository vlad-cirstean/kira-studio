package mobileflow_test

import (
	"net/http"
	"slices"
	"sync"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
)

// The phone and the desktop reorder the same backlog at once: the result is one of the two serial
// orders and no item is lost or doubled.
func TestPhoneAndDesktopWriteRace(t *testing.T) {
	f := newFixture(t)
	app := f.app
	p, deviceID := pairedPhone(t, f)
	if err := app.W.Mobile.SetDevicePermissions(bridge.MobileDevicePermissionsArgs{ID: deviceID, Write: true}); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	for _, text := range []string{"a", "b", "c", "d"} {
		it, err := app.W.AdeTask.AddBacklogItem(ctx, adewire.AddBacklogItemArgs{Text: text})
		if err != nil {
			t.Fatal(err)
		}
		ids[text] = it.ID
	}

	for round := range 10 {
		before := backlogTexts(t, app)
		var wg sync.WaitGroup
		var phoneStatus int
		var desktopErr error
		wg.Add(2)
		go func() {
			defer wg.Done()
			phoneStatus = p.post("/api/ade/backlog/move", map[string]any{"id": ids["a"], "toIndex": 3}).Status
		}()
		go func() {
			defer wg.Done()
			desktopErr = app.W.AdeTask.MoveBacklogItem(ctx, adewire.MoveBacklogItemArgs{ID: ids["d"], ToIndex: 0})
		}()
		wg.Wait()
		if phoneStatus != http.StatusOK || desktopErr != nil {
			t.Fatalf("round %d: phone %d, desktop %v", round, phoneStatus, desktopErr)
		}
		got := backlogTexts(t, app)
		sorted := slices.Sorted(slices.Values(got))
		if !slices.Equal(sorted, []string{"a", "b", "c", "d"}) {
			t.Fatalf("round %d: backlog %v lost or doubled an item", round, got)
		}
		phoneFirst := serial(before, ids["a"], 3, ids["d"], 0, ids)
		desktopFirst := serial(before, ids["d"], 0, ids["a"], 3, ids)
		if !slices.Equal(got, phoneFirst) && !slices.Equal(got, desktopFirst) {
			t.Fatalf("round %d: backlog %v after %v, want %v or %v", round, got, before, phoneFirst, desktopFirst)
		}
	}
}

// serial applies two moves in order to a list of texts.
func serial(start []string, firstID string, firstTo int, secondID string, secondTo int, ids map[string]string) []string {
	text := map[string]string{}
	for k, v := range ids {
		text[v] = k
	}
	out := slices.Clone(start)
	move := func(id string, to int) {
		i := slices.Index(out, text[id])
		item := out[i]
		out = slices.Delete(out, i, i+1)
		out = slices.Insert(out, min(to, len(out)), item)
	}
	move(firstID, firstTo)
	move(secondID, secondTo)
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
