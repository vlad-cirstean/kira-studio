package mobileflow_test

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/testx"
)

func portOf(t *testing.T, appURL string) int {
	t.Helper()
	_, port, err := net.SplitHostPort(strings.TrimSuffix(strings.TrimPrefix(appURL, "http://"), "/"))
	if err != nil {
		t.Fatal(err)
	}
	n, _ := strconv.Atoi(port)
	return n
}

func unreachable(t *testing.T, appURL string) {
	t.Helper()
	testx.WaitUntil(t, waitFor, func() bool {
		conn, err := net.DialTimeout("tcp4", strings.TrimSuffix(strings.TrimPrefix(appURL, "http://"), "/"), time.Second)
		if err == nil {
			conn.Close()
			return false
		}
		return true
	})
}

func TestEnableTrustPort(t *testing.T) {
	app := flowharness.New(t)
	st := app.W.Mobile.Status()
	if st.Enabled || st.Running || st.Trusted != nil || st.Current == nil {
		t.Fatalf("initial status = %+v, want off, untrusted, with the current network shown", st)
	}

	port := freePort(t)
	if _, err := app.W.Mobile.SetPort(bridge.MobileSetPortArgs{Port: port}); err != nil {
		t.Fatal(err)
	}
	mark := app.Events.Mark()
	st, err := app.W.Mobile.SetEnabled(bridge.MobileSetEnabledArgs{Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if !st.Enabled || st.Running || st.StopReason != "notTrusted" {
		t.Fatalf("enabled without trust = %+v, want stopped notTrusted", st)
	}

	st, err = app.W.Mobile.TrustCurrentNetwork()
	if err != nil {
		t.Fatal(err)
	}
	wantURL := "http://127.0.0.1:" + strconv.Itoa(port) + "/"
	if !st.Running || st.AppURL != wantURL || st.StopReason != "" || st.Trusted == nil || st.TrustedAt == 0 {
		t.Fatalf("after trust = %+v, want running at %s", st, wantURL)
	}
	if st.Trusted.RouterMAC != st.Current.RouterMAC || st.Trusted.Subnet != st.Current.Subnet {
		t.Fatalf("trusted %+v differs from current %+v", st.Trusted, st.Current)
	}
	app.Events.WaitAfter(t, mark, bridge.ChannelMobileStatus, func(e flowharness.Event) bool {
		var got bridge.MobileStatus
		e.Decode(t, &got)
		return got.Running
	}, waitFor)

	p := newPhone(t, st.AppURL)
	if r := p.get("/"); r.Status != http.StatusOK || !strings.Contains(string(r.Body), "<title>phone</title>") {
		t.Fatalf("GET / = %d %q, want the embedded phone page", r.Status, r.Body)
	}
	if r := p.get("/api/me"); r.Status != http.StatusUnauthorized || r.code(t) != "E_UNAUTHORIZED" {
		t.Fatalf("unpaired GET /api/me = %d %s", r.Status, r.Body)
	}

	// SetPort moves the listener.
	next := freePort(t)
	st, err = app.W.Mobile.SetPort(bridge.MobileSetPortArgs{Port: next})
	if err != nil {
		t.Fatal(err)
	}
	if !st.Running || portOf(t, st.AppURL) != next {
		t.Fatalf("after SetPort = %+v, want running on %d", st, next)
	}
	unreachable(t, wantURL)
	if r := newPhone(t, st.AppURL).get("/"); r.Status != http.StatusOK {
		t.Fatalf("GET / on the new port = %d", r.Status)
	}

	// A busy port leaves the server stopped with the reason; a free one recovers it.
	busy, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	st, err = app.W.Mobile.SetPort(bridge.MobileSetPortArgs{Port: busy.Addr().(*net.TCPAddr).Port})
	if err != nil {
		t.Fatal(err)
	}
	if st.Running || !strings.Contains(st.Error, "in use") {
		t.Fatalf("on a busy port = %+v, want stopped with an in-use error", st)
	}
	if st, err = app.W.Mobile.SetEnabled(bridge.MobileSetEnabledArgs{Enabled: false}); err != nil {
		t.Fatal(err)
	}
	if _, err = app.W.Mobile.SetPort(bridge.MobileSetPortArgs{Port: next}); err != nil {
		t.Fatal(err)
	}
	if st, err = app.W.Mobile.SetEnabled(bridge.MobileSetEnabledArgs{Enabled: true}); err != nil || !st.Running || st.Error != "" {
		t.Fatalf("re-enabled on a free port = %+v, %v", st, err)
	}

	st, err = app.W.Mobile.ForgetNetwork()
	if err != nil {
		t.Fatal(err)
	}
	if st.Running || st.StopReason != "notTrusted" || st.Trusted != nil || !st.Enabled {
		t.Fatalf("after forget = %+v, want stopped notTrusted but still enabled", st)
	}
	unreachable(t, st.Current.Address+":"+strconv.Itoa(next))

	if _, err := app.W.Mobile.TrustCurrentNetwork(); err != nil {
		t.Fatal(err)
	}
	if st = app.W.Mobile.Status(); !st.Running {
		t.Fatalf("trusting again does not restart the server: %+v", st)
	}
	st, err = app.W.Mobile.SetEnabled(bridge.MobileSetEnabledArgs{Enabled: false})
	if err != nil || st.Enabled || st.Running {
		t.Fatalf("disabled = %+v, %v", st, err)
	}
	unreachable(t, "127.0.0.1:"+strconv.Itoa(next))

	t.Run("a new port starts a server stopped by a busy one", func(t *testing.T) {
		t.Skip("P231 finding B-3")
		if _, err := app.W.Mobile.SetEnabled(bridge.MobileSetEnabledArgs{Enabled: true}); err != nil {
			t.Fatal(err)
		}
		if _, err := app.W.Mobile.SetPort(bridge.MobileSetPortArgs{Port: busy.Addr().(*net.TCPAddr).Port}); err != nil {
			t.Fatal(err)
		}
		st, err := app.W.Mobile.SetPort(bridge.MobileSetPortArgs{Port: next})
		if err != nil || !st.Running || st.Error != "" {
			t.Fatalf("SetPort off a busy port = %+v, %v, want running with no error", st, err)
		}
	})
}

func TestPhonePairing(t *testing.T) {
	app := flowharness.New(t)
	st := serve(t, app)
	a, b := newPhone(t, st.AppURL), newPhone(t, st.AppURL)

	if r := a.get("/api/ade/board"); r.Status != http.StatusUnauthorized {
		t.Fatalf("unpaired board read = %d", r.Status)
	}
	if r := a.send(http.MethodPost, "/api/pair", map[string]string{"label": "x", "code": "12"}, ""); r.Status != http.StatusBadRequest {
		t.Fatalf("pairing with a short code = %d, want 400", r.Status)
	}

	mark := app.Events.Mark()
	done, pending := a.requestPairing(app, "Ana's phone", "4821")
	if pending.Code != "4821" || pending.RemoteIP != "127.0.0.1" || pending.ClientID == "" {
		t.Fatalf("prompt = %+v", pending)
	}
	app.Events.WaitAfter(t, mark, bridge.ChannelMobilePairing, func(e flowharness.Event) bool {
		var snap bridge.MobilePairingSnapshot
		e.Decode(t, &snap)
		return snap.Pending != nil && snap.Pending.RequestID == pending.RequestID
	}, waitFor)
	if res, err := app.W.Mobile.Approve(bridge.MobileIDArgs{ID: pending.RequestID}); err != nil || res.Result != "resolved" {
		t.Fatalf("Approve = %+v, %v", res, err)
	}
	if res, _ := app.W.Mobile.Approve(bridge.MobileIDArgs{ID: pending.RequestID}); res.Result != "alreadyResolved" {
		t.Fatalf("second Approve = %+v, want alreadyResolved", res)
	}
	out := <-done
	if out.err != nil || out.reply.Status != http.StatusOK {
		t.Fatalf("approved pairing = %+v", out)
	}
	var paired struct{ DeviceID, Label string }
	out.reply.json(t, &struct {
		DeviceID *string `json:"deviceId"`
		Label    *string `json:"label"`
	}{&paired.DeviceID, &paired.Label})
	if paired.DeviceID == "" || paired.Label != "Ana's phone" {
		t.Fatalf("pairing body = %+v", paired)
	}
	var me struct {
		DeviceID    string `json:"deviceId"`
		Permissions struct {
			Write      bool `json:"write"`
			AgentInput bool `json:"agentInput"`
		} `json:"permissions"`
		AgentInputGlobal bool `json:"agentInputGlobal"`
	}
	r := a.get("/api/me")
	if r.Status != http.StatusOK {
		t.Fatalf("paired GET /api/me = %d %s", r.Status, r.Body)
	}
	r.json(t, &me)
	if me.DeviceID != paired.DeviceID || me.Permissions.AgentInput || me.AgentInputGlobal {
		t.Fatalf("me = %+v, want agent input off", me)
	}
	if r.Header.Get("Cache-Control") != "no-store" || r.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("headers = %v, want no-store and nosniff", r.Header)
	}
	devices, err := app.W.Mobile.Devices()
	if err != nil || len(devices) != 1 || devices[0].ID != paired.DeviceID {
		t.Fatalf("Devices = %+v, %v", devices, err)
	}

	// A second phone is denied and gets no cookie.
	doneB, pendingB := b.requestPairing(app, "Bo's phone", "7310")
	if res, err := app.W.Mobile.Deny(bridge.MobileIDArgs{ID: pendingB.RequestID}); err != nil || res.Result != "resolved" {
		t.Fatalf("Deny = %+v, %v", res, err)
	}
	denied := <-doneB
	if denied.err != nil || denied.reply.Status != http.StatusForbidden || denied.reply.code(t) != "E_PAIRING_DENIED/denied" {
		t.Fatalf("denied pairing = %+v %s", denied.reply.Status, denied.reply.Body)
	}
	if r := b.get("/api/me"); r.Status != http.StatusUnauthorized {
		t.Fatalf("denied phone GET /api/me = %d", r.Status)
	}

	// Revoking ends the open event stream and every later request.
	stream := a.events()
	if err := app.W.Mobile.Revoke(bridge.MobileIDArgs{ID: paired.DeviceID}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stream.closed:
	case <-time.After(waitFor):
		t.Fatal("event stream still open after Revoke")
	}
	if r := a.get("/api/me"); r.Status != http.StatusUnauthorized || r.code(t) != "E_REVOKED" {
		t.Fatalf("revoked GET /api/me = %d %s", r.Status, r.Body)
	}
	devices, _ = app.W.Mobile.Devices()
	if len(devices) != 1 || devices[0].RevokedAt == nil {
		t.Fatalf("Devices after Revoke = %+v, want the row marked revoked", devices)
	}
}
