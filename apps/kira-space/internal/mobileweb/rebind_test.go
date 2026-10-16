package mobileweb

import (
	"net/http"
	"net/netip"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/lannet"
)

func TestServer_RebindsWhenAddressChanges(t *testing.T) {
	changed := make(chan struct{}, 1)
	port := freePort(t)
	s := New(Config{
		Reader: &fakeReader{}, Devices: newFakeStore(), Hub: NewHub(), Broker: NewBroker(time.Now, nil), Assets: testAssets(),
		Port: port, Network: loopbackNet(), OnStatusChanged: func() { changed <- struct{}{} },
	})
	s.isLAN = loopbackOK
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)
	get := func(ip string) error {
		resp, err := client.Get("http://" + ip + ":" + portStr(port) + "/")
		if err == nil {
			_ = resp.Body.Close()
		}
		return err
	}
	// Host check needs the bound address, so a 403 from the guard still proves the listener answers.
	if err := get("127.0.0.2"); err == nil {
		t.Fatal("unbound address answered")
	}

	s.SetNetwork(lannet.Network{Interface: "lo", Addr: netip.MustParsePrefix("127.0.0.2/8")})
	<-changed
	if got := s.Status().AppURL; got != "http://127.0.0.2:"+portStr(port)+"/" {
		t.Fatalf("status url = %q", got)
	}
	if err := get("127.0.0.2"); err != nil {
		t.Fatalf("new address not served: %v", err)
	}
	client.CloseIdleConnections()
	if err := get("127.0.0.1"); err == nil {
		t.Fatal("old address still answers")
	}
}
