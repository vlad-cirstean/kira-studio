package mobileweb

import (
	"crypto/tls"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestServer_RebindsWhenAddressesChange(t *testing.T) {
	var mu sync.Mutex
	ips := []net.IP{net.IPv4(127, 0, 0, 1).To4()}
	changed := make(chan struct{}, 1)
	store, port := newFakeStore(), freePort(t)
	s := New(Config{
		Reader: &fakeReader{}, Devices: store, Hub: NewHub(), Broker: NewBroker(time.Now), Assets: testAssets(),
		CADir: t.TempDir(), HTTPSPort: port, SetupPort: freePort(t),
		Addrs: func() ([]net.IP, error) {
			mu.Lock()
			defer mu.Unlock()
			return append([]net.IP(nil), ips...), nil
		},
		OnStatusChanged: func() { changed <- struct{}{} },
	})
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	client := &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: s.CA().Pool(), MinVersion: tls.VersionTLS12},
	}}
	t.Cleanup(client.CloseIdleConnections)
	extra := "https://127.0.0.2:" + portStr(port) + "/setup-info"

	if resp, err := client.Get(extra); err == nil {
		_ = resp.Body.Close()
		t.Fatal("unbound address answered")
	}
	mu.Lock()
	ips = append(ips, net.IPv4(127, 0, 0, 2).To4())
	mu.Unlock()
	s.refreshAddrs()
	<-changed
	if len(s.Status().AppURLs) < 2 {
		t.Fatalf("status urls = %v", s.Status().AppURLs)
	}
	resp, err := client.Get(extra)
	if err != nil {
		t.Fatalf("new address not served with a valid certificate: %v", err)
	}
	_ = resp.Body.Close()

	mu.Lock()
	ips = ips[:1]
	mu.Unlock()
	s.refreshAddrs()
	<-changed
	client.CloseIdleConnections()
	if resp, err := client.Get(extra); err == nil {
		_ = resp.Body.Close()
		t.Fatal("removed address still answers")
	}
}
