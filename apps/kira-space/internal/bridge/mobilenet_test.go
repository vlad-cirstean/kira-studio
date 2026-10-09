package bridge

import (
	"context"
	"errors"
	"net/netip"
	"strconv"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/lannet"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/mobileweb"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"net"
)

// idleReader answers every read empty: the supervisor test never serves a request.
type idleReader struct{}

func (idleReader) Board(context.Context) (adewire.Board, error)   { return adewire.Board{}, nil }
func (idleReader) Prs(context.Context) (adewire.PrsResult, error) { return adewire.PrsResult{}, nil }
func (idleReader) Sessions(context.Context) (adewire.SessionsResult, error) {
	return adewire.SessionsResult{}, nil
}
func (idleReader) Workflows(context.Context) (adewire.WorkflowsResult, error) {
	return adewire.WorkflowsResult{}, nil
}
func (idleReader) Backlog(context.Context) (adewire.BacklogResult, error) {
	return adewire.BacklogResult{}, nil
}
func (idleReader) Repos(context.Context) (adewire.ReposResult, error) {
	return adewire.ReposResult{}, nil
}
func (idleReader) ReadLog(context.Context, adewire.ReadLogArgs) (adewire.LogPage, error) {
	return adewire.LogPage{}, nil
}

type lockedEmitter struct {
	mu    sync.Mutex
	count int
}

func (e *lockedEmitter) Emit(name string, _ any) {
	if name != ChannelMobileStatus {
		return
	}
	e.mu.Lock()
	e.count++
	e.mu.Unlock()
}
func (e *lockedEmitter) EmitTo(string, string, any) {}
func (e *lockedEmitter) EmitFocused(string, any)    {}
func (e *lockedEmitter) statuses() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.count
}

func fakeNet(ip string) lannet.Network {
	return lannet.Network{
		Interface: "en0",
		Addr:      netip.MustParsePrefix(ip + "/8"),
		Identity: lannet.Identity{
			Subnet: netip.MustParsePrefix("127.0.0.0/8"), RouterIP: netip.MustParseAddr("127.0.0.254"), RouterMAC: "aa:bb:cc:dd:ee:ff",
		},
	}
}

// TestMobileSupervisor walks the supervisor through every stop reason and back. The fake networks
// sit on loopback so the real server binds; isLAN is widened to match.
func TestMobileSupervisor(t *testing.T) {
	db, err := storage.OpenAt(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	rs, err := repos.New(db.DB)
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	if _, err := rs.Settings.Set(model.SettingsPatch{Mobile: &model.MobilePatch{Port: &port}}); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	here, findErr := fakeNet("127.0.0.1"), error(nil)
	events := &lockedEmitter{}
	svc := NewMobileAccessService(&MobileAccessService{
		Deps:   appcore.Deps{Repos: rs, Events: events},
		Reader: idleReader{},
		Hub:    mobileweb.NewHub(),
		Broker: mobileweb.NewBroker(time.Now),
		Assets: fstest.MapFS{"index.html": {Data: []byte("app")}},
		Detect: func() (lannet.Network, error) { mu.Lock(); defer mu.Unlock(); return here, nil },
		Find: func(lannet.Identity) (lannet.Network, error) {
			mu.Lock()
			defer mu.Unlock()
			return here, findErr
		},
		Poll:  time.Hour,
		IsLAN: func(a netip.Addr) bool { return a.IsLoopback() },
	})
	t.Cleanup(func() { StopMobile(svc) })
	set := func(n lannet.Network, err error) { mu.Lock(); here, findErr = n, err; mu.Unlock() }

	check := func(step string, running bool, reason, url string) MobileStatus {
		t.Helper()
		st := svc.Status()
		if st.Running != running || st.StopReason != reason || st.AppURL != url {
			t.Fatalf("%s: running=%v reason=%q url=%q, want %v %q %q (error %q)",
				step, st.Running, st.StopReason, st.AppURL, running, reason, url, st.Error)
		}
		return st
	}
	url := func(ip string) string { return "http://" + ip + ":" + portStr(port) + "/" }

	if _, err := svc.SetEnabled(MobileSetEnabledArgs{Enabled: true}); err != nil {
		t.Fatal(err)
	}
	check("enabled, nothing trusted", false, mobileStopNotTrusted, "")

	if _, err := svc.TrustCurrentNetwork(); err != nil {
		t.Fatal(err)
	}
	st := check("trusted", true, "", url("127.0.0.1"))
	if st.Trusted == nil || st.Trusted.RouterMAC != "aa:bb:cc:dd:ee:ff" {
		t.Fatalf("trusted network not reported: %+v", st.Trusted)
	}

	set(lannet.Network{}, lannet.ErrAway)
	svc.reconcile()
	check("away", false, mobileStopAway, "")

	set(lannet.Network{}, lannet.ErrOtherRouter)
	svc.reconcile()
	check("other router", false, mobileStopOtherRouter, "")

	set(lannet.Network{}, errors.New("boom"))
	svc.reconcile()
	check("lookup failure", false, mobileStopUnavailable, "")

	set(fakeNet("127.0.0.1"), nil)
	svc.reconcile()
	check("back", true, "", url("127.0.0.1"))

	set(fakeNet("127.0.0.2"), nil)
	svc.reconcile()
	check("new address, same identity", true, "", url("127.0.0.2"))

	// The rebind announces itself from a goroutine; let it land before counting.
	before := events.statuses()
	for deadline := time.Now().Add(2 * time.Second); time.Now().Before(deadline); {
		time.Sleep(50 * time.Millisecond)
		if now := events.statuses(); now != before {
			before = now
			continue
		}
		break
	}
	svc.reconcile()
	if events.statuses() != before {
		t.Fatal("an unchanged pass must not emit a status")
	}

	if _, err := svc.ForgetNetwork(); err != nil {
		t.Fatal(err)
	}
	check("forgotten", false, mobileStopNotTrusted, "")
}

func portStr(p int) string { return strconv.Itoa(p) }
