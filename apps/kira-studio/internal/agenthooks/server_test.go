package agenthooks

import (
	"bytes"
	"context"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

// newTestServer starts a real Server (a real mkdtemp dir, a real unix socket, a real http.Server)
// and registers its own cleanup — every test in this file talks to it exactly as the shim would,
// over the socket, never by calling Go methods that skip the wire.
func newTestServer(t *testing.T, onEvent func(Event)) *Server {
	t.Helper()
	s, err := New(Options{OnEvent: onEvent})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// clientFor dials s's own unix socket directly — §19.2's "over a real socket", bypassing the
// generated shim entirely (that script is covered by shim_test-shaped coverage of buildShim's own
// refusal rule, exercised below via ShellSingleQuote).
func clientFor(s *Server) *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				var d net.Dialer
				return d.DialContext(ctx, "unix", s.ln.SockPath)
			},
		},
		Timeout: 2 * time.Second,
	}
}

func postHook(t *testing.T, client *http.Client, token, terminalID, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, "http://localhost/hook", strings.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if terminalID != "" {
		req.Header.Set("X-Kira-Terminal", terminalID)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	return resp
}

// recordingEvents collects every Event OnEvent is called with, safe for concurrent use — the
// listener's own handler runs on net/http's per-request goroutine.
type recordingEvents struct {
	mu     sync.Mutex
	events []Event
}

func (r *recordingEvents) record(e Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, e)
}

func (r *recordingEvents) all() []Event {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Event, len(r.events))
	copy(out, r.events)
	return out
}

// TestValidRequestDeliversEvent is §19.2 case 1: a valid POST with a token and X-Kira-Terminal
// delivers an Event carrying the header's terminal id and the body's hook_event_name/tool_name.
func TestValidRequestDeliversEvent(t *testing.T) {
	rec := &recordingEvents{}
	s := newTestServer(t, rec.record)
	client := clientFor(s)

	body := `{"hook_event_name":"PreToolUse","session_id":"sess-1","cwd":"/repo","tool_name":"Bash","tool_use_id":"tu-1","tool_input":{"command":"rm -rf /"}}`
	resp := postHook(t, client, s.ln.Token, "term-1", body)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	events := rec.all()
	if len(events) != 1 {
		t.Fatalf("len(events) = %d, want 1", len(events))
	}
	got := events[0]
	if got.TerminalID != "term-1" {
		t.Errorf("TerminalID = %q, want %q", got.TerminalID, "term-1")
	}
	if got.Event != "PreToolUse" {
		t.Errorf("Event = %q, want %q", got.Event, "PreToolUse")
	}
	if got.ToolName != "Bash" {
		t.Errorf("ToolName = %q, want %q", got.ToolName, "Bash")
	}
	if got.ToolUseID != "tu-1" {
		t.Errorf("ToolUseID = %q, want %q", got.ToolUseID, "tu-1")
	}
}

// TestWrongTokenRejected is §19.2 case 2: a wrong token is rejected and OnEvent never fires.
func TestWrongTokenRejected(t *testing.T) {
	rec := &recordingEvents{}
	s := newTestServer(t, rec.record)
	client := clientFor(s)

	resp := postHook(t, client, "not-the-token", "term-1", `{"hook_event_name":"Stop"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
	if len(rec.all()) != 0 {
		t.Fatalf("OnEvent fired on a wrong token")
	}
}

// TestMissingTerminalHeaderRejected is §19.2 case 3: a missing X-Kira-Terminal is a 400 with no
// event.
func TestMissingTerminalHeaderRejected(t *testing.T) {
	rec := &recordingEvents{}
	s := newTestServer(t, rec.record)
	client := clientFor(s)

	resp := postHook(t, client, s.ln.Token, "", `{"hook_event_name":"Stop"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	if len(rec.all()) != 0 {
		t.Fatalf("OnEvent fired with no X-Kira-Terminal header")
	}
}

// TestOversizedBodyRejected is §19.2 case 4: a body over maxHookPayloadBytes is a 413 with no
// event.
func TestOversizedBodyRejected(t *testing.T) {
	rec := &recordingEvents{}
	s := newTestServer(t, rec.record)
	client := clientFor(s)

	oversized := `{"hook_event_name":"PreToolUse","message":"` + strings.Repeat("x", maxHookPayloadBytes+1) + `"}`
	resp := postHook(t, client, s.ln.Token, "term-1", oversized)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", resp.StatusCode)
	}
	if len(rec.all()) != 0 {
		t.Fatalf("OnEvent fired for an oversized body")
	}
}

// TestDroppedFieldsNeverReachEvent is §19.2 case 5: tool_input/tool_response/transcript_path in
// the body never appear in the delivered Event — Event has no field for any of the three, so this
// documents the guarantee encoding/json's own unknown-field skip already provides, over a payload
// that actually carries all three.
func TestDroppedFieldsNeverReachEvent(t *testing.T) {
	rec := &recordingEvents{}
	s := newTestServer(t, rec.record)
	client := clientFor(s)

	body := `{
		"hook_event_name": "PostToolUse",
		"session_id": "sess-1",
		"cwd": "/repo",
		"tool_name": "Write",
		"tool_use_id": "tu-2",
		"transcript_path": "/Users/x/.claude/projects/foo/transcript.jsonl",
		"tool_input": {"file_path": "/repo/secret.txt", "content": "sensitive contents here"},
		"tool_response": {"filePath": "/repo/secret.txt", "content": "sensitive contents here"}
	}`
	resp := postHook(t, client, s.ln.Token, "term-1", body)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	events := rec.all()
	if len(events) != 1 {
		t.Fatalf("len(events) = %d, want 1", len(events))
	}
	got := events[0]
	if got.ToolName != "Write" || got.ToolUseID != "tu-2" {
		t.Fatalf("expected fields did not survive: %+v", got)
	}
	// Event has no TranscriptPath/ToolInput/ToolResponse field at all — this call over the real
	// struct is the guarantee itself, not a string search over the response.
}

// TestCloseRemovesDirectoryAndSocket is §19.2 case 6.
func TestCloseRemovesDirectoryAndSocket(t *testing.T) {
	s := newTestServer(t, nil)
	dir := s.ln.Dir
	sock := s.ln.SockPath
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("dir should exist before Close: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("dir still exists after Close: err=%v", err)
	}
	if _, err := os.Stat(sock); !os.IsNotExist(err) {
		t.Fatalf("socket still exists after Close: err=%v", err)
	}
}

// TestShellSingleQuoteRefusesUnquotable is config.go's own non-HTTP case (§19.2's closing note):
// ShellSingleQuote refuses a path holding a single quote or a newline, a hard error rather than a
// best-effort escape.
func TestShellSingleQuoteRefusesUnquotable(t *testing.T) {
	if _, err := ShellSingleQuote("/tmp/kira-agent-abc/hook"); err != nil {
		t.Fatalf("ordinary path should not be refused: %v", err)
	}
	if _, err := ShellSingleQuote("/tmp/kira-agent-'abc/hook"); err == nil {
		t.Fatalf("a path with a single quote should be refused")
	}
	if _, err := ShellSingleQuote("/tmp/kira-agent-\nabc/hook"); err == nil {
		t.Fatalf("a path with a newline should be refused")
	}
}

// TestMessageTruncatedOnRuneBoundary guards §6.1's own bound: a Notification message over
// maxHookMessageBytes is truncated on a rune boundary, never splitting a multi-byte character.
func TestMessageTruncatedOnRuneBoundary(t *testing.T) {
	rec := &recordingEvents{}
	s := newTestServer(t, rec.record)
	client := clientFor(s)

	// A run of a 3-byte rune (€) well past maxHookMessageBytes — a byte-blind slice at exactly
	// maxHookMessageBytes would land mid-character on many offsets.
	var b strings.Builder
	for i := 0; i < maxHookMessageBytes; i++ {
		b.WriteRune('€')
	}
	msg := b.String()

	body := `{"hook_event_name":"Notification","message":` + jsonString(msg) + `}`
	resp := postHook(t, client, s.ln.Token, "term-1", body)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	events := rec.all()
	if len(events) != 1 {
		t.Fatalf("len(events) = %d, want 1", len(events))
	}
	got := events[0].Message
	if len(got) > maxHookMessageBytes {
		t.Fatalf("len(Message) = %d, want <= %d", len(got), maxHookMessageBytes)
	}
	if !isValidUTF8(got) {
		t.Fatalf("truncated message is not valid UTF-8: %q", got)
	}
}

func jsonString(s string) string {
	var buf bytes.Buffer
	buf.WriteByte('"')
	for _, r := range s {
		if r == '"' || r == '\\' {
			buf.WriteByte('\\')
		}
		buf.WriteRune(r)
	}
	buf.WriteByte('"')
	return buf.String()
}

func isValidUTF8(s string) bool {
	return utf8.ValidString(s)
}
