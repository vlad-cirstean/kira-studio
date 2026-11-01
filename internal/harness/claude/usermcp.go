package claude

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/kirathecat/kira-studio/internal/harness"
	"github.com/kirathecat/kira-studio/internal/loginshell"
)

const mcpListTimeout = 30 * time.Second

var (
	mcpListTTL = 30 * time.Second
	// mcpPresenceTTL is how long the presence check reuses a list: names change rarely, while the
	// picker wants fresh health status.
	mcpPresenceTTL = 5 * time.Minute
)

// SetMCPListTTL replaces how long a `claude mcp list` result is reused, for the picker and the
// presence check alike, and returns the restore func (a flow test passes 0 to see a config change at once).
func SetMCPListTTL(d time.Duration) (restore func()) {
	prevList, prevPresence := mcpListTTL, mcpPresenceTTL
	mcpListTTL, mcpPresenceTTL = d, d
	return func() { mcpListTTL, mcpPresenceTTL = prevList, prevPresence }
}

// mcpListArgs is the argv after claude: the only way Kira learns the user's servers.
var mcpListArgs = []string{"mcp", "list"}

// errMCPList is the only error a failed listing surfaces; claude's output never reaches it.
var errMCPList = errors.New("could not list your Claude MCP servers")

var listLine = regexp.MustCompile(`^([A-Za-z0-9_-]+): (.*?) - [^\s\p{L}\p{N}]+ (.*)$`)

// parseMCPList reads `claude mcp list` output: one `<name>: <target> - <glyph> <status>` line per
// server. Lines of any other shape (banner, blank, claude.ai connectors whose names have spaces) are
// skipped. Only name, transport, host or command name and a status class are kept: never args, paths,
// query strings or the rest of a line.
func parseMCPList(out string) []harness.UserServer {
	servers := []harness.UserServer{}
	for _, line := range strings.Split(out, "\n") {
		m := listLine.FindStringSubmatch(strings.TrimRight(line, "\r"))
		if m == nil {
			continue
		}
		target := strings.TrimSpace(m[2])
		s := harness.UserServer{Name: m[1], Transport: "stdio", Status: statusOf(m[3])}
		switch {
		case strings.HasSuffix(target, " (HTTP)"):
			s.Transport, target = "http", strings.TrimSuffix(target, " (HTTP)")
		case strings.HasSuffix(target, " (SSE)"):
			s.Transport, target = "sse", strings.TrimSuffix(target, " (SSE)")
		}
		if s.Transport == "stdio" {
			first, _, _ := strings.Cut(target, " ")
			s.Target = filepath.Base(first)
		} else if u, err := url.Parse(strings.TrimSpace(target)); err == nil {
			s.Target = u.Host
		}
		servers = append(servers, s)
	}
	return servers
}

func statusOf(text string) string {
	t := strings.ToLower(strings.TrimSpace(text))
	switch {
	case strings.HasPrefix(t, "connected"):
		return "connected"
	case strings.Contains(t, "authenticat"):
		return "needsAuth"
	case strings.HasPrefix(t, "failed"):
		return "failed"
	case strings.HasPrefix(t, "pending"), strings.HasPrefix(t, "connecting"):
		return "pending"
	}
	return "unknown"
}

type listCache struct {
	mu      sync.Mutex
	entries map[string]listEntry
	flight  singleflight.Group
}

type listEntry struct {
	servers []harness.UserServer
	at      time.Time
}

// UserMCPServers asks `claude mcp list` from dir for the MCP servers claude loads there. Kira never
// opens claude's config files or runs `claude mcp get`, which prints stored headers and env. Claude
// health-checks every server on each call, so the result is cached per dir for a short while; a failed
// listing falls back to the last good one for that dir.
func (p *Provider) UserMCPServers(ctx context.Context, dir string) ([]harness.UserServer, error) {
	return p.userServers(ctx, dir, mcpListTTL)
}

// UserMCPPresence is the list for the presence check, reused for longer than the picker's. With wait
// false it never blocks on a cold or expired cache: it refreshes in the background and returns the
// stale list, or known=false when there is none.
func (p *Provider) UserMCPPresence(ctx context.Context, dir string, wait bool) (servers []harness.UserServer, known bool, err error) {
	c := &p.mcpList
	c.mu.Lock()
	e, have := c.entries[dir]
	c.mu.Unlock()
	if have && time.Since(e.at) < mcpPresenceTTL {
		return append([]harness.UserServer{}, e.servers...), true, nil
	}
	if wait || mcpPresenceTTL <= 0 {
		servers, err = p.userServers(ctx, dir, mcpPresenceTTL)
		return servers, err == nil, err
	}
	go func() {
		_, _ = p.userServers(context.Background(), dir, 0)
	}()
	if have {
		return append([]harness.UserServer{}, e.servers...), true, nil
	}
	return nil, false, nil
}

func (p *Provider) userServers(ctx context.Context, dir string, ttl time.Duration) ([]harness.UserServer, error) {
	c := &p.mcpList
	c.mu.Lock()
	if e, ok := c.entries[dir]; ok && time.Since(e.at) < ttl {
		c.mu.Unlock()
		return append([]harness.UserServer{}, e.servers...), nil
	}
	c.mu.Unlock()
	v, err, _ := c.flight.Do(dir, func() (any, error) {
		servers, err := p.runMCPList(ctx, dir)
		if err != nil {
			// A slow or hung server must not block runs: reuse the last good list.
			c.mu.Lock()
			stale, ok := c.entries[dir]
			c.mu.Unlock()
			if ok {
				return stale.servers, nil
			}
			return nil, err
		}
		c.mu.Lock()
		if c.entries == nil {
			c.entries = map[string]listEntry{}
		}
		c.entries[dir] = listEntry{servers, time.Now()}
		c.mu.Unlock()
		return servers, nil
	})
	if err != nil {
		return nil, err
	}
	return append([]harness.UserServer{}, v.([]harness.UserServer)...), nil
}

func (p *Provider) runMCPList(ctx context.Context, dir string) ([]harness.UserServer, error) {
	if _, err := p.Locate(ctx, ""); err != nil {
		return nil, errMCPList
	}
	ctx, cancel := context.WithTimeout(ctx, mcpListTimeout)
	defer cancel()
	shell, login := loginshell.ResolveShell(os.Getenv, loginshell.IsExecutableFile)
	argv := loginshell.BuildArgv(shell, login, "exec claude "+strings.Join(mcpListArgs, " "))
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.Env = p.ScrubEnv(os.Environ())
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("%w: timed out", errMCPList)
		}
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return nil, fmt.Errorf("%w: exit code %d", errMCPList, ee.ExitCode())
		}
		return nil, errMCPList
	}
	return parseMCPList(out.String()), nil
}
