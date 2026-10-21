package claude

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/internal/harness"
)

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
func parseLine(raw string) []harness.Line {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var msg streamMsg
	if err := json.Unmarshal([]byte(raw), &msg); err != nil || msg.Type == "" {
		return []harness.Line{{Stream: harness.StreamStdout, Text: raw}}
	}
	switch msg.Type {
	case "system":
		return system(msg)
	case "assistant", "user":
		var blocks []contentBlock
		if json.Unmarshal(msg.Message.Content, &blocks) != nil {
			return nil // a plain-string user message carries nothing to show
		}
		var lines []harness.Line
		for _, b := range blocks {
			lines = append(lines, block(b)...)
		}
		return lines
	case "result":
		return []harness.Line{{Stream: harness.StreamEvent, Text: fmt.Sprintf("result: %s · %d turns", msg.Subtype, msg.NumTurns)}}
	}
	return nil
}

func system(msg streamMsg) []harness.Line {
	switch msg.Subtype {
	case "init":
		return []harness.Line{{Stream: harness.StreamEvent, Text: "session " + msg.SessionID}}
	case "permission_denied":
		name := msg.ToolName
		if name == "" {
			name = msg.Tool
		}
		return []harness.Line{{Stream: harness.StreamStderr, Text: "denied: " + name}}
	}
	return nil
}

func block(b contentBlock) []harness.Line {
	switch b.Type {
	case "text":
		return splitLines(harness.StreamStdout, b.Text)
	case "tool_use":
		return []harness.Line{{Stream: harness.StreamStdout, Text: "▸ " + b.Name + shortInput(b.Name, b.Input)}}
	case "tool_result":
		if b.IsError {
			first, _, _ := strings.Cut(strings.TrimSpace(resultText(b.Content)), "\n")
			return []harness.Line{{Stream: harness.StreamStderr, Text: "✕ " + first}}
		}
	}
	return nil
}

func splitLines(stream, text string) []harness.Line {
	parts := strings.Split(strings.TrimRight(text, "\n"), "\n")
	out := make([]harness.Line, 0, len(parts))
	for _, l := range parts {
		out = append(out, harness.Line{Stream: stream, Text: l})
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

// parseRateLimits reads a `rate_limit_event` stream line; ok is false for any other line or one
// without a five_hour or seven_day window.
func parseRateLimits(raw string) (harness.RateLimits, bool) {
	if !strings.Contains(raw, `"rate_limit_event"`) {
		return harness.RateLimits{}, false
	}
	var msg struct {
		Type          string `json:"type"`
		RateLimitInfo struct {
			UnifiedWindows struct {
				FiveHour *streamWindow `json:"five_hour"`
				SevenDay *streamWindow `json:"seven_day"`
			} `json:"unifiedWindows"`
		} `json:"rate_limit_info"`
	}
	if json.Unmarshal([]byte(raw), &msg) != nil || msg.Type != "rate_limit_event" {
		return harness.RateLimits{}, false
	}
	w := msg.RateLimitInfo.UnifiedWindows
	if w.FiveHour == nil && w.SevenDay == nil {
		return harness.RateLimits{}, false
	}
	return harness.RateLimits{FiveHour: w.FiveHour.window(), SevenDay: w.SevenDay.window()}, true
}

// streamWindow is one window as the stream reports it: utilization is a 0..1 fraction.
type streamWindow struct {
	Utilization float64 `json:"utilization"`
	ResetsAt    int64   `json:"resetsAt"`
}

func (w *streamWindow) window() *harness.RateWindow {
	if w == nil {
		return nil
	}
	return &harness.RateWindow{UsedPercent: w.Utilization * 100, ResetsAt: w.ResetsAt}
}

const maxResultText = 1 << 10

// resultEnd maps the closing line's subtype and is_error flag to how the run ended.
func resultEnd(subtype string, isError bool) harness.ResultEnd {
	switch {
	case subtype == "error_max_budget_usd":
		return harness.EndBudget
	case subtype == "error_max_turns":
		return harness.EndMaxTurns
	case isError:
		return harness.EndError
	}
	return harness.EndDone
}

// parseResult reads a `result` stream line; ok is false for any other line.
func parseResult(raw string) (harness.Result, bool) {
	if !strings.Contains(raw, `"result"`) {
		return harness.Result{}, false
	}
	var msg struct {
		Type    string   `json:"type"`
		Subtype string   `json:"subtype"`
		IsError bool     `json:"is_error"`
		Cost    *float64 `json:"total_cost_usd"`
		Result  string   `json:"result"`
		Denials []struct {
			ToolName string `json:"tool_name"`
		} `json:"permission_denials"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(raw)), &msg) != nil || msg.Type != "result" {
		return harness.Result{}, false
	}
	r := harness.Result{End: resultEnd(msg.Subtype, msg.IsError), CostUSD: msg.Cost, Text: msg.Result}
	if len(r.Text) > maxResultText {
		r.Text = strings.ToValidUTF8(r.Text[:maxResultText], "") + "…"
	}
	seen := map[string]bool{}
	for _, d := range msg.Denials {
		if d.ToolName != "" && !seen[d.ToolName] {
			seen[d.ToolName] = true
			r.Denials = append(r.Denials, d.ToolName)
		}
	}
	return r, true
}

const noConversationPrefix = "No conversation found with session ID:"

// ResumeLost reports whether a stderr line is the CLI's answer to --resume of an unknown session.
func (*Provider) ResumeLost(line string) bool {
	return strings.HasPrefix(strings.TrimSpace(line), noConversationPrefix)
}
