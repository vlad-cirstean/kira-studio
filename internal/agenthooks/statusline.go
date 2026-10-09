package agenthooks

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// maxStatusLineBytes bounds one /statusline body; a statusline payload is a few KiB.
const maxStatusLineBytes = 64 * 1024

// RateWindow is one Claude Code rate-limit window as its statusline reports it.
type RateWindow struct {
	UsedPercentage float64 `json:"used_percentage"`
	// ResetsAt is Unix epoch seconds.
	ResetsAt int64 `json:"resets_at"`
}

// RateLimits is the only part of a statusline payload this package decodes; either window may be
// absent (Claude Code omits a window it has no data for).
type RateLimits struct {
	FiveHour *RateWindow `json:"five_hour"`
	SevenDay *RateWindow `json:"seven_day"`
}

type statusLineRequest struct {
	RateLimits *RateLimits `json:"rate_limits"`
}

// statusLineEntry is the settings `statusLine` object.
type statusLineEntry struct {
	Type            string `json:"type"`
	Command         string `json:"command"`
	Padding         *int   `json:"padding,omitempty"`
	RefreshInterval *int   `json:"refreshInterval,omitempty"`
}

// handleStatusLine is POST /statusline: same token and terminal checks as /hook, then a bounded
// body of which only rate_limits is kept.
func (s *Server) handleStatusLine(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if subtle.ConstantTimeCompare([]byte(bearerToken(r)), []byte(s.ln.Token)) != 1 {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	terminalID := r.Header.Get("X-Kira-Terminal")
	if terminalID == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	var req statusLineRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxStatusLineBytes)).Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if s.onStatusLine != nil && req.RateLimits != nil && (req.RateLimits.FiveHour != nil || req.RateLimits.SevenDay != nil) {
		s.onStatusLine(terminalID, *req.RateLimits)
	}
	w.WriteHeader(http.StatusOK)
}

// composeStatusLine writes this terminal's settings file (hooks plus the statusline wrapper) and
// returns its single-quoted path and the extra env carrying the user's own statusline command.
func (s *Server) composeStatusLine(terminalID, cwd string) (string, []string, error) {
	user := userStatusLine(cwd)
	entry := &statusLineEntry{Type: "command", Command: s.quotedShim + " statusline"}
	var extra []string
	if user != nil {
		entry.Padding, entry.RefreshInterval = user.Padding, user.RefreshInterval
		if !strings.ContainsRune(user.Command, 0) {
			extra = []string{"KIRA_USER_STATUSLINE=" + user.Command}
		}
	}
	doc, err := buildHooksDocument(s.quotedShim, entry)
	if err != nil {
		return "", nil, err
	}
	sum := sha256.Sum256([]byte(terminalID))
	path := filepath.Join(s.ln.Dir, "settings-"+hex.EncodeToString(sum[:])[:12]+".json")
	if err := os.WriteFile(path, doc, 0o600); err != nil {
		return "", nil, fmt.Errorf("agenthooks: write settings: %w", err)
	}
	quoted, err := shellSingleQuote(path)
	if err != nil {
		return "", nil, err
	}
	return quoted, extra, nil
}

// userStatusLine returns the statusline the CLI would use without Kira, read-only, by its
// precedence: project local, project, user. A file that is missing or unparseable is skipped.
func userStatusLine(cwd string) *statusLineEntry {
	var paths []string
	if cwd != "" {
		paths = append(paths,
			filepath.Join(cwd, ".claude", "settings.local.json"), filepath.Join(cwd, ".claude", "settings.json"))
	}
	dir := os.Getenv("CLAUDE_CONFIG_DIR")
	if dir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			dir = filepath.Join(home, ".claude")
		}
	}
	if dir != "" {
		paths = append(paths, filepath.Join(dir, "settings.json"))
	}
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var doc struct {
			StatusLine *statusLineEntry `json:"statusLine"`
		}
		if json.Unmarshal(raw, &doc) != nil || doc.StatusLine == nil {
			continue
		}
		if doc.StatusLine.Type == "command" && doc.StatusLine.Command != "" {
			return doc.StatusLine
		}
	}
	return nil
}
