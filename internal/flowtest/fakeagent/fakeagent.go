// Package fakeagent is the stand-in for the claude and gh CLIs in flow tests. A flow runs it as a
// re-executed test binary (flowharness.Main) or as the cmd/fakeclaude binary; the behaviour comes
// from scenario data in KIRA_FAKE_SCEN (JSON, or the path of a JSON file), so a stream extends it with testdata, not code.
//
// Every call writes its argv, cwd and stdin under KIRA_FAKE_DIR as <repo>-<n>.args/.cwd/.prompt
// (claude, where <repo> is the worktree's parent directory name) or gh-<n>.args. A scripted Action.MCP
// call also keeps its result as mcp-<tool>-<n>.json.
package fakeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Environment variables the fake reads.
const (
	EnvScenario = "KIRA_FAKE_SCEN"
	EnvDir      = "KIRA_FAKE_DIR"
)

// Scenario is the KIRA_FAKE_SCEN document.
type Scenario struct {
	// Claude maps a repo name (the worktree's parent directory, "*" as fallback) to one Action per
	// attempt; the last Action repeats.
	Claude map[string][]Action `json:"claude,omitempty"`
	// Prompts answer headless calls by their --system-prompt before any Claude action runs; the
	// first rule that matches answers (the call still counts as an attempt for Claude).
	Prompts []PromptRule `json:"prompts,omitempty"`
	// Gh rules are tried in order; the first whose Match is a substring of the joined args answers.
	Gh []GhRule `json:"gh,omitempty"`
}

// Encode returns the KIRA_FAKE_SCEN value.
func (s Scenario) Encode() string {
	b, err := json.Marshal(s)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// Action is one claude attempt. A bare JSON string is shorthand for Action{Name: s}.
//
// Named behaviours: "done", "needs_input" and "failed" call finish_step with that status (done also
// prints one tool_use); "fail" exits 1 with a message on stderr; "nofinish" ends without
// finish_step; "sleep" blocks for an hour. The generic fields run first, in the order below, and
// compose with a name.
type Action struct {
	Name string `json:"name,omitempty"`
	// Sh runs a snippet through sh in the agent's cwd (an agent commit: git commit ...).
	Sh string `json:"sh,omitempty"`
	// MCP calls tools on servers from the --mcp-config file.
	MCP []MCPCall `json:"mcp,omitempty"`
	// Emit prints the file to stdout.
	Emit string `json:"emit,omitempty"`
	// WaitFile blocks until the path exists.
	WaitFile string `json:"waitFile,omitempty"`
	// Exit, when set, ends the run with that code instead of the named behaviour.
	Exit *int `json:"exit,omitempty"`
}

// UnmarshalJSON accepts the string shorthand.
func (a *Action) UnmarshalJSON(b []byte) error {
	var name string
	if json.Unmarshal(b, &name) == nil {
		*a = Action{Name: name}
		return nil
	}
	type plain Action
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	*a = Action(p)
	return nil
}

// MCPCall is one tool call on a server named in --mcp-config.
type MCPCall struct {
	Server string         `json:"server"`
	Tool   string         `json:"tool"`
	Args   map[string]any `json:"args,omitempty"`
}

// PromptRule answers a headless call whose --system-prompt contains System. Doc narrows it to one
// document: the basename of the first "path" in the prompt, or of KIRA_DOC, which the fake exports to
// the MCP servers it starts so a nested call (memory-mcp's gate) keeps the document it belongs to.
// Fail makes the first N matching calls end with a budget error; the rule's calls are counted in
// <KIRA_FAKE_DIR>/rule-<index>.count. WaitFile blocks until the path exists, then Emit prints the file.
type PromptRule struct {
	System   string `json:"system"`
	Doc      string `json:"doc,omitempty"`
	Fail     int    `json:"fail,omitempty"`
	WaitFile string `json:"waitFile,omitempty"`
	Emit     string `json:"emit,omitempty"`
}

// GhRule answers a gh invocation.
type GhRule struct {
	Match  string `json:"match"`
	Emit   string `json:"emit,omitempty"`
	Stderr string `json:"stderr,omitempty"`
	Exit   int    `json:"exit,omitempty"`
}

// Run plays the named tool ("claude" or "gh") for one invocation and returns its exit code.
func Run(name string, args []string) int {
	var scen Scenario
	raw := []byte(os.Getenv(EnvScenario))
	if len(raw) > 0 && raw[0] != '{' { // a path, as the e2e-real fixture sets it
		raw, _ = os.ReadFile(string(raw))
	}
	_ = json.Unmarshal(raw, &scen)
	dir := os.Getenv(EnvDir)
	switch name {
	case "claude":
		return runClaude(scen, dir, args)
	case "gh":
		return runGh(scen, dir, args)
	}
	fmt.Fprintln(os.Stderr, "fakeagent: unknown tool", name)
	return 127
}

func nextCount(dir, stem string) int {
	counter := filepath.Join(dir, stem+".count")
	n := 0
	if raw, err := os.ReadFile(counter); err == nil {
		_, _ = fmt.Sscanf(string(raw), "%d", &n)
	}
	n++
	_ = os.WriteFile(counter, []byte(fmt.Sprint(n)), 0o644)
	return n
}

func runGh(scen Scenario, dir string, args []string) int {
	n := nextCount(dir, "gh")
	_ = os.WriteFile(filepath.Join(dir, fmt.Sprintf("gh-%d.args", n)), []byte(strings.Join(args, "\n")), 0o644)
	joined := strings.Join(args, " ")
	for _, r := range scen.Gh {
		if !strings.Contains(joined, r.Match) {
			continue
		}
		if r.Emit != "" {
			raw, err := os.ReadFile(r.Emit)
			if err != nil {
				fmt.Fprintln(os.Stderr, "fakeagent:", err)
				return 3
			}
			_, _ = os.Stdout.Write(raw)
		}
		if r.Stderr != "" {
			fmt.Fprintln(os.Stderr, r.Stderr)
		}
		return r.Exit
	}
	fmt.Fprintln(os.Stderr, "fakeagent: no gh rule for:", joined)
	return 1
}

func runClaude(scen Scenario, dir string, args []string) int {
	cwd, _ := os.Getwd()
	repo := filepath.Base(filepath.Dir(cwd))
	actions := scen.Claude[repo]
	if len(actions) == 0 {
		actions = scen.Claude["*"]
	}
	n := nextCount(dir, repo)
	action := Action{Name: "done"}
	if len(actions) > 0 {
		action = actions[min(n, len(actions))-1]
	}
	stem := filepath.Join(dir, fmt.Sprintf("%s-%d", repo, n))
	_ = os.WriteFile(stem+".args", []byte(strings.Join(args, "\n")), 0o644)
	_ = os.WriteFile(stem+".cwd", []byte(cwd), 0o644)

	headless := false
	for _, a := range args {
		if a == "-p" || a == "--print" {
			headless = true
		}
	}
	if headless {
		if code, done := startHeadless(scen, dir, stem, args); done {
			return code
		}
	} else {
		recordTUIInput(stem)
	}

	if action.Sh != "" {
		cmd := exec.Command("sh", "-c", action.Sh)
		cmd.Dir = cwd
		if out, err := cmd.CombinedOutput(); err != nil {
			fmt.Fprintf(os.Stderr, "sh: %v\n%s", err, out)
			return 4
		}
	}
	cfg := argAfter(args, "--mcp-config")
	for _, c := range action.MCP {
		res, err := callTool(cfg, c.Server, c.Tool, c.Args)
		if err != nil {
			fmt.Fprintln(os.Stderr, "mcp:", err)
			return 3
		}
		recordMCPResult(dir, c.Tool, res)
	}
	if action.Emit != "" {
		raw, err := os.ReadFile(action.Emit)
		if err != nil {
			fmt.Fprintln(os.Stderr, "fakeagent:", err)
			return 3
		}
		_, _ = os.Stdout.Write(raw)
	}
	if action.WaitFile != "" {
		for {
			if _, err := os.Stat(action.WaitFile); err == nil {
				break
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
	if action.Exit != nil {
		return *action.Exit
	}

	finish := func(status string) int {
		if _, err := callTool(cfg, claudeheadless.ServerName, "finish_step", map[string]any{"status": status, "summary": "summary-" + status}); err != nil {
			fmt.Fprintln(os.Stderr, "finish_step:", err)
			return 3
		}
		emitJSON(map[string]any{"type": "result", "subtype": "success", "num_turns": 2})
		return 0
	}
	switch action.Name {
	case "done":
		emitJSON(map[string]any{"type": "assistant", "message": map[string]any{"content": []any{map[string]any{
			"type": "tool_use", "id": "t-bash", "name": "Bash", "input": map[string]any{"command": "git status"},
		}}}})
		return finish("done")
	case "needs_input", "failed":
		return finish(action.Name)
	case "fail":
		fmt.Fprintln(os.Stderr, "fake claude: scripted failure")
		return 1
	case "sleep":
		time.Sleep(time.Hour)
	case "":
		return 0
	}
	if headless {
		emitJSON(map[string]any{"type": "result", "subtype": "success", "num_turns": 1})
	}
	return 0 // "nofinish"
}

var promptPath = regexp.MustCompile(`"path":"([^"]*)"`)

// promptDoc is the basename of the first "path" the prompt names, or KIRA_DOC when it names none.
func promptDoc(prompt []byte) string {
	if m := promptPath.FindSubmatch(prompt); m != nil {
		return filepath.Base(string(m[1]))
	}
	return os.Getenv("KIRA_DOC")
}

// answerPrompt plays the first PromptRule matching the call's system prompt.
func answerPrompt(scen Scenario, dir string, args []string) (code int, answered bool) {
	system, doc := argAfter(args, "--system-prompt"), os.Getenv("KIRA_DOC")
	for i, r := range scen.Prompts {
		if !strings.Contains(system, r.System) || (r.Doc != "" && r.Doc != doc) {
			continue
		}
		if r.Fail > 0 {
			if nextCount(dir, fmt.Sprintf("rule-%d", i)) <= r.Fail {
				emitJSON(map[string]any{"type": "result", "subtype": "error_max_budget_usd", "is_error": true})
				return 0, true
			}
			continue
		}
		for r.WaitFile != "" {
			if _, err := os.Stat(r.WaitFile); err == nil {
				break
			}
			time.Sleep(50 * time.Millisecond)
		}
		if r.Emit != "" {
			raw, err := os.ReadFile(r.Emit)
			if err != nil {
				fmt.Fprintln(os.Stderr, "fakeagent:", err)
				return 3, true
			}
			_, _ = os.Stdout.Write(raw)
		}
		return 0, true
	}
	return 0, false
}

// startHeadless records the prompt and plays a matching PromptRule; done is true when the rule
// answered the whole call.
func startHeadless(scen Scenario, dir, stem string, args []string) (code int, done bool) {
	prompt, _ := io.ReadAll(os.Stdin)
	_ = os.WriteFile(stem+".prompt", prompt, 0o644)
	if doc := promptDoc(prompt); doc != "" {
		_ = os.Setenv("KIRA_DOC", doc)
	}
	if code, answered := answerPrompt(scen, dir, args); answered {
		return code, true
	}
	// A one-document json caller parses stdout as a single value, so it gets no stream.
	if argAfter(args, "--output-format") != "json" {
		emitJSON(map[string]any{"type": "system", "subtype": "init", "session_id": "fake"})
	}
	return 0, false
}

// recordTUIInput keeps what the app types into an interactive TUI session, whose stdin is a PTY.
func recordTUIInput(stem string) {
	go func() {
		f, err := os.OpenFile(stem+".prompt", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return
		}
		defer f.Close()
		_, _ = io.Copy(f, os.Stdin)
	}()
}

func emitJSON(v any) {
	raw, _ := json.Marshal(v)
	fmt.Println(string(raw))
}

func argAfter(args []string, flag string) string {
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

type bearer struct{ token string }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(r)
}

// callTool connects to server from the --mcp-config file (HTTP or stdio entry) and calls one tool.
func callTool(cfgPath, server, tool string, args map[string]any) (*mcp.CallToolResult, error) {
	raw := []byte(cfgPath)
	if !strings.HasPrefix(strings.TrimSpace(cfgPath), "{") {
		var err error
		if raw, err = os.ReadFile(cfgPath); err != nil {
			return nil, err
		}
	}
	var cfg struct {
		MCPServers map[string]struct {
			URL     string            `json:"url"`
			Headers map[string]string `json:"headers"`
			Command string            `json:"command"`
			Args    []string          `json:"args"`
			Env     map[string]string `json:"env"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	entry, ok := cfg.MCPServers[server]
	if !ok {
		return nil, fmt.Errorf("server %q not in %s", server, cfgPath)
	}
	var transport mcp.Transport
	if entry.Command != "" {
		cmd := exec.Command(entry.Command, entry.Args...)
		cmd.Env = os.Environ()
		for k, v := range entry.Env {
			cmd.Env = append(cmd.Env, k+"="+v)
		}
		transport = &mcp.CommandTransport{Command: cmd}
	} else {
		token := strings.TrimPrefix(entry.Headers["Authorization"], "Bearer ")
		transport = &mcp.StreamableClientTransport{
			Endpoint: entry.URL, HTTPClient: &http.Client{Transport: bearer{token}}, DisableStandaloneSSE: true, MaxRetries: -1,
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	sess, err := mcp.NewClient(&mcp.Implementation{Name: "fake", Version: "1"}, nil).Connect(ctx, transport, nil)
	if err != nil {
		return nil, err
	}
	defer sess.Close()
	res, err := sess.CallTool(ctx, &mcp.CallToolParams{Name: tool, Arguments: args})
	if err != nil {
		return nil, err
	}
	if res.IsError {
		return nil, fmt.Errorf("tool error: %v", res.Content)
	}
	return res, nil
}

// recordMCPResult keeps what a scripted tool call returned, as <dir>/mcp-<tool>-<n>.json.
func recordMCPResult(dir, tool string, res *mcp.CallToolResult) {
	var v any = res.StructuredContent
	if v == nil {
		v = res.Content
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return
	}
	n := nextCount(dir, "mcp-"+tool)
	_ = os.WriteFile(filepath.Join(dir, fmt.Sprintf("mcp-%s-%d.json", tool, n)), raw, 0o644)
}
