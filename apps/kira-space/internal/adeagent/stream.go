package adeagent

import (
	"encoding/json"
	"fmt"
	"regexp"
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

// Todo is the agent's todo progress.
type Todo struct{ Done, Total int }

// Parser turns `claude -p --output-format stream-json` lines into log lines and todo progress. It
// follows both todo tools: TodoWrite (older CLIs, the full list per call) and TaskCreate/TaskUpdate
// (CLI 2.1.x, one task per call, ids learned from the tool result).
type Parser struct {
	toolName map[string]string // tool_use id -> tool name, for TaskCreate results
	tasks    map[string]bool   // task id -> completed (deleted ids are removed)
	last     Todo
	hasLast  bool
}

// NewParser returns a Parser with empty todo state.
func NewParser() *Parser {
	return &Parser{toolName: map[string]string{}, tasks: map[string]bool{}}
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
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	ToolUseID string          `json:"tool_use_id"`
	IsError   bool            `json:"is_error"`
	Content   json.RawMessage `json:"content"`
}

var taskCreated = regexp.MustCompile(`Task #(\d+)`)

// Feed parses one stdout line. todo is non-nil only when the progress changed.
func (p *Parser) Feed(raw string) (lines []Line, todo *Todo) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var msg streamMsg
	if err := json.Unmarshal([]byte(raw), &msg); err != nil || msg.Type == "" {
		return []Line{{StreamStdout, raw}}, nil
	}
	switch msg.Type {
	case "system":
		lines = p.system(msg)
	case "assistant", "user":
		var blocks []contentBlock
		if json.Unmarshal(msg.Message.Content, &blocks) != nil {
			return nil, nil // a plain-string user message carries nothing to show
		}
		for _, b := range blocks {
			lines = append(lines, p.block(b)...)
		}
	case "result":
		lines = []Line{{StreamEvent, fmt.Sprintf("result: %s · %d turns", msg.Subtype, msg.NumTurns)}}
	}
	return lines, p.progress()
}

func (p *Parser) system(msg streamMsg) []Line {
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

func (p *Parser) block(b contentBlock) []Line {
	switch b.Type {
	case "text":
		return splitLines(StreamStdout, b.Text)
	case "tool_use":
		p.toolName[b.ID] = b.Name
		p.trackTodoCall(b)
		return []Line{{StreamStdout, "▸ " + b.Name + shortInput(b.Name, b.Input)}}
	case "tool_result":
		text := resultText(b.Content)
		if p.toolName[b.ToolUseID] == "TaskCreate" {
			if m := taskCreated.FindStringSubmatch(text); m != nil {
				p.tasks[m[1]] = false
			}
		}
		if b.IsError {
			first, _, _ := strings.Cut(strings.TrimSpace(text), "\n")
			return []Line{{StreamStderr, "✕ " + first}}
		}
	}
	return nil
}

func (p *Parser) trackTodoCall(b contentBlock) {
	switch b.Name {
	case "TodoWrite":
		var in struct {
			Todos []struct {
				Status string `json:"status"`
			} `json:"todos"`
		}
		if json.Unmarshal(b.Input, &in) != nil {
			return
		}
		p.tasks = map[string]bool{}
		for i, t := range in.Todos {
			p.tasks[fmt.Sprint(i)] = t.Status == "completed"
		}
	case "TaskUpdate":
		var in struct {
			TaskID string `json:"taskId"`
			Status string `json:"status"`
		}
		if json.Unmarshal(b.Input, &in) != nil {
			return
		}
		switch in.Status {
		case "completed":
			p.tasks[in.TaskID] = true
		case "deleted":
			delete(p.tasks, in.TaskID)
		}
	}
}

// progress reports the todo counts when they differ from the last report.
func (p *Parser) progress() *Todo {
	cur := Todo{Total: len(p.tasks)}
	for _, done := range p.tasks {
		if done {
			cur.Done++
		}
	}
	if cur.Total == 0 || (p.hasLast && cur == p.last) {
		return nil
	}
	p.last, p.hasLast = cur, true
	return &cur
}

func splitLines(stream, text string) []Line {
	var out []Line
	for _, l := range strings.Split(strings.TrimRight(text, "\n"), "\n") {
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
