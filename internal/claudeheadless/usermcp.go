package claudeheadless

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	listToolsTimeout = 15 * time.Second
	maxListedTools   = 200
)

// UserServer is one MCP server from the user's own Claude config, described without its secrets.
type UserServer struct {
	Name string `json:"name"`
	// Transport is stdio, http or sse.
	Transport string `json:"transport"`
	// Target is the command's base name or the URL host. Never args, env or headers.
	Target string `json:"target"`
}

// UserTool is one tool a user MCP server offers.
type UserTool struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type rawServer struct {
	Type    string            `json:"type"`
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
}

func (r rawServer) transport() string {
	switch r.Type {
	case "http", "sse":
		return r.Type
	case "", "stdio":
		if r.Command == "" && r.URL != "" {
			return "http"
		}
		return "stdio"
	}
	return r.Type
}

// userConfigPath is the Claude user-scope config file: $CLAUDE_CONFIG_DIR/.claude.json, else
// $HOME/.claude.json.
func userConfigPath(env func(string) string) string {
	if d := env("CLAUDE_CONFIG_DIR"); d != "" {
		return filepath.Join(d, ".claude.json")
	}
	return filepath.Join(env("HOME"), ".claude.json")
}

// readUserServers reads the top-level mcpServers of the user's Claude config. The file is never
// written. A missing file is no servers.
func readUserServers(env func(string) string) (map[string]json.RawMessage, error) {
	data, err := os.ReadFile(userConfigPath(env))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("could not read your Claude config: %w", err)
	}
	var doc struct {
		MCPServers map[string]json.RawMessage `json:"mcpServers"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("could not read your Claude config: %w", err)
	}
	return doc.MCPServers, nil
}

// UserServers lists the MCP servers of the user's Claude config (user scope only), by name.
func UserServers(env func(string) string) ([]UserServer, error) {
	raw, err := readUserServers(env)
	if err != nil {
		return nil, err
	}
	out := make([]UserServer, 0, len(raw))
	for name, msg := range raw {
		var r rawServer
		if json.Unmarshal(msg, &r) != nil {
			continue
		}
		s := UserServer{Name: name, Transport: r.transport()}
		if s.Transport == "stdio" {
			s.Target = filepath.Base(r.Command)
		} else if u, err := url.Parse(r.URL); err == nil {
			s.Target = u.Host
		}
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

type headerTransport struct {
	headers map[string]string
	base    http.RoundTripper
}

func (h headerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	for k, v := range h.headers {
		r.Header.Set(k, v)
	}
	return h.base.RoundTrip(r)
}

// ListTools connects to one user MCP server as a client and lists its tools. cwd is the working
// directory of a stdio server.
func ListTools(ctx context.Context, env func(string) string, name, cwd string) ([]UserTool, error) {
	tools, err := listTools(ctx, env, name, cwd)
	if err != nil {
		return nil, fmt.Errorf("could not list tools of %s: %w", name, err)
	}
	return tools, nil
}

func listTools(ctx context.Context, env func(string) string, name, cwd string) ([]UserTool, error) {
	all, err := readUserServers(env)
	if err != nil {
		return nil, err
	}
	msg, ok := all[name]
	if !ok {
		return nil, errors.New("it is not in your Claude config")
	}
	var r rawServer
	if err := json.Unmarshal(msg, &r); err != nil {
		return nil, errors.New("its config is not valid")
	}
	ctx, cancel := context.WithTimeout(ctx, listToolsTimeout)
	defer cancel()

	var transport mcp.Transport
	switch r.transport() {
	case "stdio":
		if r.Command == "" {
			return nil, errors.New("it has no command")
		}
		cmd := exec.CommandContext(ctx, r.Command, r.Args...)
		cmd.Dir = cwd
		cmd.Env = os.Environ()
		for k, v := range r.Env {
			cmd.Env = append(cmd.Env, k+"="+v)
		}
		transport = &mcp.CommandTransport{Command: cmd, TerminateDuration: time.Second}
	case "http":
		transport = &mcp.StreamableClientTransport{Endpoint: r.URL, HTTPClient: &http.Client{Transport: headerTransport{r.Headers, http.DefaultTransport}}, MaxRetries: -1}
	case "sse":
		transport = &mcp.SSEClientTransport{Endpoint: r.URL, HTTPClient: &http.Client{Transport: headerTransport{r.Headers, http.DefaultTransport}}}
	default:
		return nil, fmt.Errorf("transport %q is not supported", r.Type)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "kira", Version: "1"}, nil)
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		return nil, err
	}
	defer session.Close()

	var out []UserTool
	for t, err := range session.Tools(ctx, nil) {
		if err != nil {
			return nil, err
		}
		if len(out) == maxListedTools {
			break
		}
		out = append(out, UserTool{Name: t.Name, Description: firstLine(t.Description)})
	}
	return out, nil
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(s), "\n")
	if r := []rune(line); len(r) > 200 {
		return string(r[:200]) + "…"
	}
	return line
}

// ErrServerGone is wrapped by WriteUserConfig when a named server left the user's config.
type ErrServerGone struct{ Name string }

func (e ErrServerGone) Error() string {
	return "MCP server " + e.Name + " is no longer in your Claude config"
}

// WriteUserConfig copies the named servers from the user's Claude config into a 0600 --mcp-config
// file under dir (0700). release removes the file.
func WriteUserConfig(env func(string) string, dir, runID string, names []string) (path string, release func(), err error) {
	all, err := readUserServers(env)
	if err != nil {
		return "", nil, err
	}
	picked := map[string]json.RawMessage{}
	for _, n := range names {
		msg, ok := all[n]
		if !ok {
			return "", nil, ErrServerGone{Name: n}
		}
		picked[n] = msg
	}
	body, err := json.Marshal(map[string]any{"mcpServers": picked})
	if err != nil {
		return "", nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", nil, fmt.Errorf("claudeheadless: config dir: %w", err)
	}
	path = filepath.Join(dir, runID+"-user.mcp.json")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		return "", nil, fmt.Errorf("claudeheadless: write user mcp config: %w", err)
	}
	return path, func() { _ = os.Remove(path) }, nil
}
