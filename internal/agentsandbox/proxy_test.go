package agentsandbox

import (
	"context"
	"encoding/base64"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestProxyRefusals(t *testing.T) {
	var upstream atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { upstream.Add(1) }))
	defer srv.Close()

	h := newHub()
	var denied []Denial
	h.add("run-1", func(d Denial) { denied = append(denied, d) })
	p, err := StartProxy(h)
	if err != nil {
		t.Fatal(err)
	}
	proxyURL, _ := url.Parse(p.Register("run-1", func(host string) bool { return host == "api.anthropic.com" }))

	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	resp, err := client.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden || upstream.Load() != 0 {
		t.Fatalf("plain HTTP: status %d, upstream hits %d; want 403 and 0", resp.StatusCode, upstream.Load())
	}
	if len(denied) != 1 || denied[0].Op != "network" {
		t.Fatalf("plain HTTP denial not recorded: %+v", denied)
	}

	connect := func(auth string) int {
		t.Helper()
		conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(context.Background(), "tcp", p.addr)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		req := "CONNECT evil.example:443 HTTP/1.1\r\nHost: evil.example:443\r\n" + auth + "\r\n"
		if _, err := conn.Write([]byte(req)); err != nil {
			t.Fatal(err)
		}
		buf := make([]byte, 64)
		n, _ := conn.Read(buf)
		if !strings.Contains(string(buf[:n]), " ") {
			t.Fatalf("no status line: %q", buf[:n])
		}
		return int(buf[9]-'0')*100 + int(buf[10]-'0')*10 + int(buf[11]-'0')
	}
	if got := connect(""); got != http.StatusForbidden {
		t.Fatalf("CONNECT without token: %d", got)
	}
	pw, _ := proxyURL.User.Password()
	auth := "Proxy-Authorization: Basic " + basic("kira:"+pw) + "\r\n"
	if got := connect(auth); got != http.StatusForbidden {
		t.Fatalf("CONNECT to non-allowlisted host: %d", got)
	}
	if len(denied) != 2 {
		t.Fatalf("denials %d, want 2", len(denied))
	}
}

func basic(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
