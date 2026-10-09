package claudeheadless

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Log streams, matching the ade_log_chunks stream values.
const (
	StreamStdout = "stdout"
	StreamStderr = "stderr"
	StreamEvent  = "event"
)

// Line is one log line.
type Line struct {
	Stream string
	Text   string
}

type streamMsg struct {
	Type    string `json:"type"`
	Subtype string `json:"subtype"`
	Message struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
	SessionID string `json:"session_id"`
	NumTurns  int    `json:"num_turns"`
	ToolName  string `json:"tool_name"`
	Tool      string `json:"tool"`
}

type contentBlock struct {
	Type    string          `json:"type"`
	Text    string          `json:"text"`
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input"`
	IsError bool            `json:"is_error"`
	Content json.RawMessage `json:"content"`
}

// parseLine turns one `claude -p --output-format stream-json` line into log lines.
func parseLine(raw string) []Line {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var msg streamMsg
	if err := json.Unmarshal([]byte(raw), &msg); err != nil || msg.Type == "" {
		return []Line{{StreamStdout, raw}}
	}
	switch msg.Type {
	case "system":
		return system(msg)
	case "assistant", "user":
		var blocks []contentBlock
		if json.Unmarshal(msg.Message.Content, &blocks) != nil {
			return nil // a plain-string user message carries nothing to show
		}
		var lines []Line
		for _, b := range blocks {
			lines = append(lines, block(b)...)
		}
		return lines
	case "result":
		return []Line{{StreamEvent, fmt.Sprintf("result: %s · %d turns", msg.Subtype, msg.NumTurns)}}
	}
	return nil
}

func system(msg streamMsg) []Line {
	switch msg.Subtype {
	case "init":
		return []Line{{StreamEvent, "session " + msg.SessionID}}
	case "permission_denied":
		name := msg.ToolName
		if name == "" {
			name = msg.Tool
		}
		return []Line{{StreamStderr, "denied: " + name}}
	}
	return nil
}

func block(b contentBlock) []Line {
	switch b.Type {
	case "text":
		return splitLines(StreamStdout, b.Text)
	case "tool_use":
		return []Line{{StreamStdout, "▸ " + b.Name + shortInput(b.Name, b.Input)}}
	case "tool_result":
		if b.IsError {
			first, _, _ := strings.Cut(strings.TrimSpace(resultText(b.Content)), "\n")
			return []Line{{StreamStderr, "✕ " + first}}
		}
	}
	return nil
}

func splitLines(stream, text string) []Line {
	parts := strings.Split(strings.TrimRight(text, "\n"), "\n")
	out := make([]Line, 0, len(parts))
	for _, l := range parts {
		out = append(out, Line{stream, l})
	}
	return out
}

// resultText flattens a tool_result content: a string, or an array of text blocks.
func resultText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var blocks []contentBlock
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	var parts []string
	for _, b := range blocks {
		if b.Type == "text" {
			parts = append(parts, b.Text)
		}
	}
	return strings.Join(parts, "\n")
}

const maxInputText = 200

// shortInput is the one-glance argument of a tool call: a Bash command or a file path.
func shortInput(name string, raw json.RawMessage) string {
	var in struct {
		Command  string `json:"command"`
		FilePath string `json:"file_path"`
	}
	if json.Unmarshal(raw, &in) != nil {
		return ""
	}
	arg := in.FilePath
	if name == "Bash" {
		first, _, _ := strings.Cut(in.Command, "\n")
		arg = first
	}
	if arg == "" {
		return ""
	}
	if r := []rune(arg); len(r) > maxInputText {
		arg = string(r[:maxInputText]) + "…"
	}
	return " " + arg
}

// RateWindow is one rate-limit window of a rate_limit_event; Utilization is a 0..1 fraction and
// ResetsAt Unix seconds.
type RateWindow struct {
	Utilization float64 `json:"utilization"`
	ResetsAt    int64   `json:"resetsAt"`
}

// RateLimits holds the windows a rate_limit_event carried; either may be nil.
type RateLimits struct {
	FiveHour *RateWindow
	SevenDay *RateWindow
}

// parseRateLimits reads a `rate_limit_event` stream line; ok is false for any other line or one
// without a five_hour or seven_day window.
func parseRateLimits(raw string) (RateLimits, bool) {
	if !strings.Contains(raw, `"rate_limit_event"`) {
		return RateLimits{}, false
	}
	var msg struct {
		Type          string `json:"type"`
		RateLimitInfo struct {
			UnifiedWindows struct {
				FiveHour *RateWindow `json:"five_hour"`
				SevenDay *RateWindow `json:"seven_day"`
			} `json:"unifiedWindows"`
		} `json:"rate_limit_info"`
	}
	if json.Unmarshal([]byte(raw), &msg) != nil || msg.Type != "rate_limit_event" {
		return RateLimits{}, false
	}
	w := msg.RateLimitInfo.UnifiedWindows
	if w.FiveHour == nil && w.SevenDay == nil {
		return RateLimits{}, false
	}
	return RateLimits{FiveHour: w.FiveHour, SevenDay: w.SevenDay}, true
}
