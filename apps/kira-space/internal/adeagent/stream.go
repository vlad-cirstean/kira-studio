package adeagent

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
