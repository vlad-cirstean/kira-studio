package claudecfg

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// ConfigPath is the user-scope Claude Code config file: $CLAUDE_CONFIG_DIR/.claude.json when the
// variable is set, else <home>/.claude.json.
func ConfigPath(getenv func(string) string, home string) string {
	if dir := getenv("CLAUDE_CONFIG_DIR"); dir != "" {
		return filepath.Join(dir, ".claude.json")
	}
	return filepath.Join(home, ".claude.json")
}

// Entry is one registration an earlier Kira version made. Summary is the command or URL, never a
// credential.
type Entry struct {
	Name    string `json:"name"`
	Summary string `json:"summary"`
}

// Legacy lists the Kira-written entries found in File.
type Legacy struct {
	File    string  `json:"file"`
	Entries []Entry `json:"entries"`
}

// Names returns the entry names in order.
func (l Legacy) Names() []string {
	out := make([]string, len(l.Entries))
	for i, e := range l.Entries {
		out[i] = e.Name
	}
	return out
}

type rawServer map[string]json.RawMessage

// DetectLegacy reads the top-level mcpServers of the file at path and returns the entries whose
// every field matches what a Kira version wrote. Project-scoped entries are never read: Kira
// always registered with --scope user. A missing file yields no entries.
func DetectLegacy(path string) (Legacy, error) {
	out := Legacy{File: path, Entries: []Entry{}}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	var doc struct {
		Servers map[string]rawServer `json:"mcpServers"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return out, fmt.Errorf("parse %s: %w", path, err)
	}
	exe, _ := os.Executable()
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	for _, name := range []string{NameMemory, NameDB, NameRepoMap} {
		srv, ok := doc.Servers[name]
		if !ok {
			continue
		}
		var summary string
		switch name {
		case NameMemory:
			summary, ok = matchMemory(srv, exe)
		case NameDB:
			summary, ok = matchDB(srv)
		case NameRepoMap:
			summary, ok = matchRepoMap(srv)
		}
		if ok {
			out.Entries = append(out.Entries, Entry{Name: name, Summary: summary})
		}
	}
	return out, nil
}

func (s rawServer) onlyKeys(allowed ...string) bool {
	for k := range s {
		found := false
		for _, a := range allowed {
			found = found || k == a
		}
		if !found {
			return false
		}
	}
	return true
}

func (s rawServer) str(key string) (string, bool) {
	var v string
	raw, ok := s[key]
	if !ok || json.Unmarshal(raw, &v) != nil {
		return "", false
	}
	return v, true
}

func (s rawServer) strMap(key string) (map[string]string, bool) {
	var v map[string]string
	raw, ok := s[key]
	if !ok || json.Unmarshal(raw, &v) != nil {
		return nil, false
	}
	return v, true
}

func matchMemory(s rawServer, exe string) (string, bool) {
	if !s.onlyKeys("type", "command", "args") {
		return "", false
	}
	if t, _ := s.str("type"); t != "stdio" {
		return "", false
	}
	var args []string
	if raw, ok := s["args"]; !ok || json.Unmarshal(raw, &args) != nil || len(args) != 1 || args[0] != "memory-mcp" {
		return "", false
	}
	cmd, _ := s.str("command")
	if !filepath.IsAbs(cmd) {
		return "", false
	}
	if base := filepath.Base(cmd); base != "Kira Space" && base != "kira-space" && cmd != exe {
		return "", false
	}
	return cmd + " memory-mcp", true
}

func bearerOnly(s rawServer) bool {
	h, ok := s.strMap("headers")
	if !ok || len(h) != 1 {
		return false
	}
	tok, ok := strings.CutPrefix(h["Authorization"], "Bearer ")
	return ok && strings.TrimSpace(tok) != ""
}

func matchDB(s rawServer) (string, bool) {
	if !s.onlyKeys("type", "url", "headersHelper", "headers") {
		return "", false
	}
	if t, _ := s.str("type"); t != "http" {
		return "", false
	}
	u, _ := s.str("url")
	if u != "http://127.0.0.1:8766/mcp" && u != "http://localhost:8766/mcp" {
		return "", false
	}
	helper, hasHelper := s.str("headersHelper")
	_, hasHeaders := s["headers"]
	switch {
	case hasHelper && !hasHeaders:
		p := strings.Trim(helper, "'")
		if !filepath.IsAbs(p) || filepath.Base(p) != "mcp-header-helper.sh" {
			return "", false
		}
	case hasHeaders && !hasHelper:
		if !bearerOnly(s) {
			return "", false
		}
	default:
		return "", false
	}
	return u, true
}

func matchRepoMap(s rawServer) (string, bool) {
	if !s.onlyKeys("type", "url", "headers") {
		return "", false
	}
	if t, _ := s.str("type"); t != "http" || !bearerOnly(s) {
		return "", false
	}
	raw, _ := s.str("url")
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Path != "/mcp" || u.RawQuery != "" || u.User != nil {
		return "", false
	}
	if port, err := strconv.Atoi(u.Port()); err != nil || port < 1 || port > 65535 {
		return "", false
	}
	return raw, true
}
