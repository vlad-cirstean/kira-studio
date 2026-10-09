package claudecfg

import (
	"context"
	"encoding/json"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// EndpointFile is the DB MCP endpoint file's name under Kira Studio's home.
const EndpointFile = "mcp-db-endpoint.json"

const dialTimeout = 300 * time.Millisecond

// DBEndpoint is where Kira Studio's running DB MCP server listens and the script that supplies its
// bearer header. It carries no token.
type DBEndpoint struct {
	URL           string `json:"url"`
	HeadersHelper string `json:"headersHelper"`
}

// WriteDBEndpoint atomically writes the endpoint file (0600) under home.
func WriteDBEndpoint(home string, ep DBEndpoint) error {
	raw, err := json.Marshal(ep)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(home, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(home, EndpointFile+".tmp-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(home, EndpointFile))
}

// RemoveDBEndpoint deletes the endpoint file; a missing file is not an error.
func RemoveDBEndpoint(home string) error {
	if err := os.Remove(filepath.Join(home, EndpointFile)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// ReadDBEndpoint returns the endpoint under home only while it is trustworthy and live: a loopback
// http URL ending in /mcp, an absolute helper that exists, and a TCP listener answering within
// 300 ms. A stale file after a Studio crash fails the dial.
func ReadDBEndpoint(ctx context.Context, home string) (DBEndpoint, bool) {
	raw, err := os.ReadFile(filepath.Join(home, EndpointFile))
	if err != nil {
		return DBEndpoint{}, false
	}
	var ep DBEndpoint
	if json.Unmarshal(raw, &ep) != nil {
		return DBEndpoint{}, false
	}
	u, err := url.Parse(ep.URL)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Path != "/mcp" || u.RawQuery != "" || u.User != nil {
		return DBEndpoint{}, false
	}
	if port, err := strconv.Atoi(u.Port()); err != nil || port < 1 || port > 65535 {
		return DBEndpoint{}, false
	}
	if !filepath.IsAbs(ep.HeadersHelper) {
		return DBEndpoint{}, false
	}
	if st, err := os.Stat(ep.HeadersHelper); err != nil || !st.Mode().IsRegular() {
		return DBEndpoint{}, false
	}
	dialCtx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	var d net.Dialer
	conn, err := d.DialContext(dialCtx, "tcp", net.JoinHostPort("127.0.0.1", u.Port()))
	if err != nil {
		return DBEndpoint{}, false
	}
	_ = conn.Close()
	return ep, true
}
