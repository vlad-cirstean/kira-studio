package bridge

import (
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"reflect"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/lannet"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// mobileSupervisor holds what the network supervisor decided. stateMu guards the fields and is
// never held across a call into the embedded service (whose StatusFn and StartFn read them);
// runMu serializes reconcile passes.
type mobileSupervisor struct {
	runMu sync.Mutex

	stateMu sync.Mutex
	active  bool
	stop    chan struct{}
	done    chan struct{}
	net     lannet.Network // what the next server start binds
	reason  string
	detail  string
	current *MobileNetwork
	last    *MobileStatus // last status emitted by a pass
}

func (m *mobileSupervisor) network() lannet.Network {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	return m.net
}

func toMobileNetwork(n lannet.Network) *MobileNetwork {
	return &MobileNetwork{
		Interface: n.Interface, Address: n.Addr.Addr().String(), Subnet: n.Identity.Subnet.String(),
		RouterIP: n.Identity.RouterIP.String(), RouterMAC: n.Identity.RouterMAC,
	}
}

// fillNetwork adds the supervisor's view and the stored trusted network to st.
func (s *MobileAccessService) fillNetwork(st *MobileStatus) {
	s.sup.stateMu.Lock()
	st.StopReason, st.StopDetail, st.Current = s.sup.reason, s.sup.detail, s.sup.current
	s.sup.stateMu.Unlock()
	if t, ok, err := s.Deps.Repos.MobileNetwork.Get(); err == nil && ok {
		st.Trusted = &MobileNetwork{
			Interface: t.Interface, Subnet: t.Subnet, RouterIP: t.RouterIP, RouterMAC: t.RouterMAC,
		}
		st.TrustedAt = t.TrustedAt
	}
}

// withCurrent reads the current network on demand while no supervisor polls it.
func (s *MobileAccessService) withCurrent(st MobileStatus) MobileStatus {
	s.sup.stateMu.Lock()
	active := s.sup.active
	s.sup.stateMu.Unlock()
	if !active {
		st.Current = nil
		if n, err := s.Detect(); err == nil {
			st.Current = toMobileNetwork(n)
		}
	}
	return st
}

// startSupervisor runs one pass now, then one per Poll while the server is enabled.
func (s *MobileAccessService) startSupervisor() {
	s.sup.stateMu.Lock()
	if s.sup.active {
		s.sup.stateMu.Unlock()
		return
	}
	s.sup.active = true
	stop, done := make(chan struct{}), make(chan struct{})
	s.sup.stop, s.sup.done = stop, done
	s.sup.stateMu.Unlock()

	s.reconcile()
	go func() {
		defer close(done)
		tick := time.NewTicker(s.Poll)
		defer tick.Stop()
		for {
			select {
			case <-tick.C:
				s.reconcile()
			case <-stop:
				return
			}
		}
	}()
}

// stopSupervisor ends polling and waits for an in-flight pass. The caller stops the server after.
func (s *MobileAccessService) stopSupervisor() {
	s.sup.stateMu.Lock()
	stop, done := s.sup.stop, s.sup.done
	s.sup.stop, s.sup.done = nil, nil
	s.sup.stateMu.Unlock()
	if stop != nil {
		close(stop)
		<-done
	}
	s.sup.runMu.Lock()
	s.sup.stateMu.Lock()
	s.sup.active, s.sup.reason, s.sup.detail, s.sup.current, s.sup.last = false, "", "", nil, nil
	s.sup.stateMu.Unlock()
	s.sup.runMu.Unlock()
}

// reconcile makes the server match the machine's network: stopped unless the trusted network is
// present, rebound when its interface address changed. A no-op once the supervisor is off.
func (s *MobileAccessService) reconcile() {
	s.sup.runMu.Lock()
	defer s.sup.runMu.Unlock()
	s.sup.stateMu.Lock()
	active := s.sup.active
	s.sup.stateMu.Unlock()
	if !active {
		return
	}

	var current *MobileNetwork
	if n, err := s.Detect(); err == nil {
		current = toMobileNetwork(n)
	}
	reason, detail, match := s.evaluate()
	s.sup.stateMu.Lock()
	s.sup.current, s.sup.reason, s.sup.detail = current, reason, detail
	if match != nil {
		s.sup.net = *match
	}
	s.sup.stateMu.Unlock()

	switch {
	case match == nil:
		s.embedded.Stop()
	default:
		s.embedded.Mu.Lock()
		srv := s.embedded.Server
		s.embedded.Mu.Unlock()
		if srv != nil {
			srv.SetNetwork(*match)
		} else if _, err := s.embedded.SetRunning(true); err != nil {
			slog.Warn("mobile access: start", "scope", "mobileweb", "err", err)
		}
	}
	s.emitIfChanged()
}

// evaluate decides whether the server may run: a nil network means stopped, with the reason.
func (s *MobileAccessService) evaluate() (reason, detail string, match *lannet.Network) {
	trusted, ok, err := s.Deps.Repos.MobileNetwork.Get()
	if err != nil {
		return mobileStopUnavailable, err.Error(), nil
	}
	if !ok {
		return mobileStopNotTrusted, "No trusted network. Trust this network to start the phone server.", nil
	}
	id, err := identityOf(trusted)
	if err != nil {
		return mobileStopUnavailable, err.Error(), nil
	}
	n, err := s.Find(id)
	switch {
	case err == nil:
		return "", "", &n
	case errors.Is(err, lannet.ErrAway):
		return mobileStopAway, "Stopped: this computer is not on the trusted network " + trusted.Subnet + ".", nil
	case errors.Is(err, lannet.ErrOtherRouter):
		return mobileStopOtherRouter, "Stopped: the router on " + trusted.Subnet + " is not the trusted one.", nil
	default:
		return mobileStopUnavailable, err.Error(), nil
	}
}

func (s *MobileAccessService) emitIfChanged() {
	st := s.embedded.Status()
	s.sup.stateMu.Lock()
	same := s.sup.last != nil && reflect.DeepEqual(*s.sup.last, st)
	s.sup.last = &st
	s.sup.stateMu.Unlock()
	if !same {
		s.emitStatus(st)
	}
}

// TrustCurrentNetwork stores the network behind the default route as the only trusted one.
func (s *MobileAccessService) TrustCurrentNetwork() (MobileStatus, error) {
	n, err := s.Detect()
	if err != nil {
		return MobileStatus{}, ipcerr.BadRequest(err.Error())
	}
	err = s.Deps.Repos.MobileNetwork.Set(model.TrustedNetwork{
		Subnet: n.Identity.Subnet.String(), RouterIP: n.Identity.RouterIP.String(),
		RouterMAC: n.Identity.RouterMAC, Interface: n.Interface, TrustedAt: time.Now().UnixMilli(),
	})
	if err != nil {
		return MobileStatus{}, ipcerr.InternalErr(err)
	}
	return s.afterNetworkChange(), nil
}

// ForgetNetwork clears the trusted network; the server stops.
func (s *MobileAccessService) ForgetNetwork() (MobileStatus, error) {
	if err := s.Deps.Repos.MobileNetwork.Clear(); err != nil {
		return MobileStatus{}, ipcerr.InternalErr(err)
	}
	return s.afterNetworkChange(), nil
}

func (s *MobileAccessService) afterNetworkChange() MobileStatus {
	s.reconcile()
	st := s.withCurrent(s.embedded.Status())
	s.emitStatus(st)
	return st
}

func identityOf(t model.TrustedNetwork) (lannet.Identity, error) {
	subnet, err := netip.ParsePrefix(t.Subnet)
	if err != nil {
		return lannet.Identity{}, fmt.Errorf("trusted network subnet: %w", err)
	}
	router, err := netip.ParseAddr(t.RouterIP)
	if err != nil {
		return lannet.Identity{}, fmt.Errorf("trusted network router: %w", err)
	}
	return lannet.Identity{Subnet: subnet, RouterIP: router, RouterMAC: t.RouterMAC}, nil
}
