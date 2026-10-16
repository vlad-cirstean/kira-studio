package mobileflow_test

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/flowtest/notifysink"
	"github.com/kirathecat/kira-studio/internal/prompts"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// pairingEntries waits until the router lists n mobile-pairing popups.
func pairingEntries(t *testing.T, app *flowharness.App, n int) []prompts.Routed {
	t.Helper()
	var got []prompts.Routed
	testx.WaitUntil(t, waitFor, func() bool {
		got = got[:0]
		all, err := app.W.PromptsSvc.List()
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range all {
			if p.Kind == prompts.KindMobilePairing {
				got = append(got, p)
			}
		}
		return len(got) == n
	})
	return got
}

func TestMobilePairingRoutes(t *testing.T) {
	app := flowharness.New(t)
	sink := notifysink.New()
	app.W.Prompts.SetSink(sink)
	app.W.Windows.Add("w1", 0, nil, func() {})
	st := serve(t, app)
	a, b := newPhone(t, st.AppURL), newPhone(t, st.AppURL)

	doneA, pendingA := a.requestPairing(app, "Ana's phone", "4821")
	got := pairingEntries(t, app, 1)
	if got[0].Ref != pendingA.RequestID || got[0].Target != "w1" || got[0].Origin != "" {
		t.Fatalf("entry = %+v, want ref %s targeted at w1", got[0], pendingA.RequestID)
	}
	if title := got[0].Title; !strings.Contains(title, "Ana's phone") || strings.Contains(title, "4821") {
		t.Fatalf("title %q must name the phone and never carry the code", title)
	}
	if _, ok := sink.Shown("prompt:mobile-pairing"); !ok {
		t.Fatal("no pairing note")
	}

	if _, err := app.W.Mobile.Approve(bridge.MobileIDArgs{ID: pendingA.RequestID}); err != nil {
		t.Fatal(err)
	}
	<-doneA
	pairingEntries(t, app, 0)
	testx.WaitUntil(t, waitFor, func() bool { _, ok := sink.Shown("prompt:mobile-pairing"); return !ok })

	// A denied request closes its popup too. Requests queue per client address, so this is the
	// same loopback client after its approval.
	doneB, pendingB := b.requestPairing(app, "Bo's phone", "7310")
	if got := pairingEntries(t, app, 1); got[0].Ref != pendingB.RequestID {
		t.Fatalf("entry = %+v, want ref %s", got[0], pendingB.RequestID)
	}
	if _, err := app.W.Mobile.Deny(bridge.MobileIDArgs{ID: pendingB.RequestID}); err != nil {
		t.Fatal(err)
	}
	<-doneB
	pairingEntries(t, app, 0)
	testx.WaitUntil(t, waitFor, func() bool { _, ok := sink.Shown("prompt:mobile-pairing"); return !ok })
}
