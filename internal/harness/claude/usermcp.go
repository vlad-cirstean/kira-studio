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
	"slices"
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
// health-checks every server on each call, so the result is cached per dir for a short while. A failed
// listing falls back to the last good one for that dir, with every status reset to unknown.
func (p *Provider) UserMCPServers(ctx context.Context, dir string) ([]harness.UserServer, error) {
	servers, stale, err := p.userServers(ctx, dir, mcpListTTL)
	if stale {
		for i := range servers {
			servers[i].Status = "unknown"
		}
	}
	return servers, err
}

// UserMCPPresence is the list for the presence check of the want names. A cached list younger than
// mcpPresenceTTL answers when it has every name; a miss is a reason to re-list, not a verdict, unless
// the list is younger than the picker's TTL. With wait false it never blocks: it refreshes in the
// background and returns the cached list only when that list has every name, else known=false.
func (p *Provider) UserMCPPresence(ctx context.Context, dir string, want []string, wait bool) (servers []harness.UserServer, known bool, err error) {
	c := &p.mcpList
	c.mu.Lock()
	e, have := c.entries[dir]
	c.mu.Unlock()
	age := time.Since(e.at)
	complete := have && hasAll(e.servers, want)
	if have && ((complete && age < mcpPresenceTTL) || age < mcpListTTL) {
		return append([]harness.UserServer{}, e.servers...), true, nil
	}
	if wait {
		servers, _, err = p.userServers(ctx, dir, mcpListTTL)
		return servers, err == nil, err
	}
	go func() {
		_, _, _ = p.userServers(context.Background(), dir, 0)
	}()
	if complete {
		return append([]harness.UserServer{}, e.servers...), true, nil
	}
	return nil, false, nil
}

func hasAll(servers []harness.UserServer, want []string) bool {
	for _, name := range want {
		if !slices.ContainsFunc(servers, func(u harness.UserServer) bool { return u.Name == name }) {
			return false
		}
	}
	return true
}

type listResult struct {
	servers []harness.UserServer
	stale   bool
}

// userServers lists dir, reusing a result younger than ttl. stale is true when a failed listing fell
// back to the last good one. The shared flight runs on a context detached from the first caller, so
// one caller stopping never fails the others; each caller waits under its own ctx.
func (p *Provider) userServers(ctx context.Context, dir string, ttl time.Duration) (servers []harness.UserServer, stale bool, err error) {
	c := &p.mcpList
	c.mu.Lock()
	if e, ok := c.entries[dir]; ok && time.Since(e.at) < ttl {
		c.mu.Unlock()
		return append([]harness.UserServer{}, e.servers...), false, nil
	}
	c.mu.Unlock()
	flightCtx := context.WithoutCancel(ctx)
	ch := c.flight.DoChan(dir, func() (any, error) {
		servers, err := p.runMCPList(flightCtx, dir)
		if err != nil {
			// A slow or hung server must not block runs: reuse the last good list.
			c.mu.Lock()
			old, ok := c.entries[dir]
			c.mu.Unlock()
			if ok {
				return listResult{old.servers, true}, nil
			}
			return nil, err
		}
		c.mu.Lock()
		if c.entries == nil {
			c.entries = map[string]listEntry{}
		}
		c.entries[dir] = listEntry{servers, time.Now()}
		c.mu.Unlock()
		return listResult{servers, false}, nil
	})
	select {
	case <-ctx.Done():
		return nil, false, ctx.Err()
	case r := <-ch:
		if r.Err != nil {
			return nil, false, r.Err
		}
		res := r.Val.(listResult)
		return append([]harness.UserServer{}, res.servers...), res.stale, nil
	}
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
