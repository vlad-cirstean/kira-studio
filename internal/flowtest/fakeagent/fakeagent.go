// Package fakeagent is the stand-in for the claude and gh CLIs in flow tests. A flow runs it as a
// re-executed test binary (flowharness.Main) or as the cmd/fakeclaude binary; the behaviour comes
// from scenario data in KIRA_FAKE_SCEN (JSON, or the path of a JSON file), so a stream extends it
// with testdata, not code.
//
// Every call writes its argv (last, atomically: it marks the call as fully recorded), cwd and stdin
// under KIRA_FAKE_DIR as <repo>-<n>.args/.cwd/.prompt
// (claude, where <repo> is the worktree's parent directory name) or gh-<n>.args. A claude call also
// keeps its KIRA_* environment (one Go-quoted entry per line) as <repo>-<n>.env and a copy of each
// --mcp-config file as
// <repo>-<n>.mcp<i>. Run as "fake-mcp" it is a stdio MCP server with tools echo and ping. A
// scripted Action.MCP
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
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/renameio/v2"
	"github.com/kirathecat/kira-studio/internal/agentmcp"
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
// prints one tool_use); "result:<id>" calls it with the step result id <id>; "fail" exits 1 with a
// message on stderr; "nofinish" ends without finish_step; "lost" exits 1 with the CLI's
// no-conversation error for the --resume id; "sleep" blocks for an hour. The generic fields run
// first, in the order below, and compose with a name.
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
	// Stderr replaces the "fail" behaviour's message (a CLI error line such as a sign-in failure).
	Stderr string `json:"stderr,omitempty"`
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
	// Tolerate records a tool error as the result and carries on instead of ending the run.
	Tolerate bool `json:"tolerate,omitempty"`
}

// PromptRule answers a headless call whose --system-prompt contains System. Doc narrows it to one
// document: the basename of the first "path" (else "source") in the prompt, or of KIRA_DOC, which
// the fake exports to
// the MCP servers it starts so a nested call (memory-mcp's gate) keeps the document it belongs to.
// Fail makes the first N matching calls end with a budget error; the rule's calls are counted in
// <KIRA_FAKE_DIR>/rule-<index>.count. WaitFile blocks until the path exists,
// then Emit prints the file.
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

// Persona is the name of the generic agent CLI that interactive sessions of a test-only provider
// run (internal/flowtest/fakeprovider): it records its argv and idles until stdin closes.
const Persona = "kira-fake-agent"

// Run plays the named tool ("claude", "gh", "fake-mcp" or Persona) for one invocation and returns its exit code.
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
	case "fake-mcp":
		return runFakeMCP()
	case Persona:
		return runPersona(dir, args)
	}
	fmt.Fprintln(os.Stderr, "fakeagent: unknown tool", name)
	return 127
}

// nextCount claims the next call number for stem. O_EXCL on <stem>-<n>.claim makes concurrent fake
// processes take distinct numbers; <stem>.count mirrors the claimed number for tests that read it.
func nextCount(dir, stem string) int {
	n := 1
	for ; ; n++ {
		f, err := os.OpenFile(filepath.Join(dir, fmt.Sprintf("%s-%d.claim", stem, n)), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			_ = f.Close()
			break
		}
		if !os.IsExist(err) {
			break
		}
	}
	_ = renameio.WriteFile(filepath.Join(dir, stem+".count"), []byte(fmt.Sprint(n)), 0o644)
	return n
}

// writeFile writes atomically: a reader sees the whole file or none.
func writeFile(path string, data []byte) {
	_ = renameio.WriteFile(path, data, 0o644)
}

func runGh(scen Scenario, dir string, args []string) int {
	n := nextCount(dir, "gh")
	writeFile(filepath.Join(dir, fmt.Sprintf("gh-%d.args", n)), []byte(strings.Join(args, "\n")))
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
	action := pickAction(scen, dir, repo, cwd, args)
	headless := slices.Contains(args, "-p") || slices.Contains(args, "--print")
	if headless {
		if code, done := startHeadless(scen, dir, action.stem, args); done {
			return code
		}
	} else {
		recordTUIInput(action.stem)
	}
	if code, done := runSideEffects(action.Action, dir, cwd, args); done {
		return code
	}
	return finishAction(action.Action, args, headless)
}

type pickedAction struct {
	Action
	stem string
}

// pickAction selects this call's scripted action and records the call's args, cwd, env and MCP configs.
func pickAction(scen Scenario, dir, repo, cwd string, args []string) pickedAction {
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
	writeFile(stem+".cwd", []byte(cwd))
	recordEnv(stem)
	for i, cfg := range argsAfter(args, "--mcp-config") {
		if raw, err := os.ReadFile(cfg); err == nil {
			writeFile(fmt.Sprintf("%s.mcp%d", stem, i), raw)
		}
	}
	writeFile(stem+".args", []byte(strings.Join(args, "\n"))) // marker: the call is fully recorded
	return pickedAction{Action: action, stem: stem}
}

// runSideEffects plays the action's shell, MCP calls, emit and wait; done reports an early exit code.
func runSideEffects(action Action, dir, cwd string, args []string) (code int, done bool) {
	if action.Sh != "" {
		cmd := exec.Command("sh", "-c", action.Sh)
		cmd.Dir = cwd
		if out, err := cmd.CombinedOutput(); err != nil {
			fmt.Fprintf(os.Stderr, "sh: %v\n%s", err, out)
			return 4, true
		}
	}
	for _, c := range action.MCP {
		res, err := callTool(argsAfter(args, "--mcp-config"), c.Server, c.Tool, c.Args)
		if err != nil && res != nil && c.Tolerate {
			recordMCPResult(dir, c.Tool, res)
			continue
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "mcp:", err)
			return 3, true
		}
		recordMCPResult(dir, c.Tool, res)
	}
	if action.Emit != "" {
		raw, err := os.ReadFile(action.Emit)
		if err != nil {
			fmt.Fprintln(os.Stderr, "fakeagent:", err)
			return 3, true
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
		return *action.Exit, true
	}
	return 0, false
}

// finishAction ends the run per the action's name, calling finish_step where the name asks for it.
func finishAction(action Action, args []string, headless bool) int {
	cfg := argAfter(args, "--mcp-config")
	finish := func(status string) int {
		if _, err := callTool([]string{cfg}, agentmcp.ServerName, "finish_step", map[string]any{"status": status, "summary": "summary-" + status}); err != nil {
			fmt.Fprintln(os.Stderr, "finish_step:", err)
			return 3
		}
		emitJSON(map[string]any{"type": "result", "subtype": "success", "num_turns": 2})
		return 0
	}
	if id, ok := strings.CutPrefix(action.Name, "result:"); ok {
		return finish(id)
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
		fmt.Fprintln(os.Stderr, cmpStr(action.Stderr, "fake claude: scripted failure"))
		return 1
	case "lost":
		fmt.Fprintln(os.Stderr, "No conversation found with session ID: "+argAfter(args, "--resume"))
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

// runPersona writes the call's argv to <dir>/kira-fake-agent-<n>.args and what the app types into
// the PTY to .prompt, then idles until stdin closes.
func runPersona(dir string, args []string) int {
	stem := filepath.Join(dir, fmt.Sprintf("%s-%d", Persona, nextCount(dir, Persona)))
	writeFile(stem+".args", []byte(strings.Join(args, "\n")))
	f, err := os.OpenFile(stem+".prompt", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintln(os.Stderr, "fakeagent:", err)
		return 1
	}
	defer f.Close()
	_, _ = io.Copy(f, os.Stdin)
	return 0
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

// argsAfter returns the value after every occurrence of flag.
func argsAfter(args []string, flag string) []string {
	var out []string
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			out = append(out, args[i+1])
		}
	}
	return out
}

// recordEnv keeps the KIRA_* variables the call was started with, and in <stem>.sandbox-env the
// variables a sandbox launch sets (kept apart so host values never reach the KIRA_* record).
func recordEnv(stem string) {
	var lines, sandbox []string
	for _, kv := range os.Environ() {
		switch {
		case strings.HasPrefix(kv, "KIRA_PARAM_") || strings.HasPrefix(kv, "KIRA_TASK") || strings.HasPrefix(kv, "KIRA_BRANCH"):
			lines = append(lines, strconv.Quote(kv))
		case strings.HasPrefix(kv, "TMPDIR=") || strings.HasPrefix(kv, "GIT_OPTIONAL_LOCKS=") || strings.HasPrefix(kv, "SSH_AUTH_SOCK=") || strings.HasPrefix(kv, "HTTPS_PROXY="):
			sandbox = append(sandbox, strconv.Quote(kv))
		}
	}
	sort.Strings(lines)
	sort.Strings(sandbox)
	writeFile(stem+".env", []byte(strings.Join(lines, "\n")))
	writeFile(stem+".sandbox-env", []byte(strings.Join(sandbox, "\n")))
}

func cmpStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
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
func callTool(cfgPaths []string, server, tool string, args map[string]any) (*mcp.CallToolResult, error) {
	type serverEntry struct {
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
		Command string            `json:"command"`
		Args    []string          `json:"args"`
		Env     map[string]string `json:"env"`
	}
	var entry serverEntry
	found := false
	for _, path := range cfgPaths {
		raw := []byte(path)
		if !strings.HasPrefix(strings.TrimSpace(path), "{") {
			var err error
			if raw, err = os.ReadFile(path); err != nil {
				return nil, err
			}
		}
		var cfg struct {
			MCPServers map[string]serverEntry `json:"mcpServers"`
		}
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return nil, err
		}
		if e, ok := cfg.MCPServers[server]; ok {
			entry, found = e, true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("server %q not in %s", server, strings.Join(cfgPaths, ", "))
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
		return res, fmt.Errorf("tool error: %s", toolText(res))
	}
	return res, nil
}

// CallTool calls one tool on a server named in the MCP config files (paths or inline JSON), as the
// fake claude does for finish_step; a test provider's headless role uses it with HeadlessSpec.MCPConfigs.
func CallTool(cfgPaths []string, server, tool string, args map[string]any) error {
	_, err := callTool(cfgPaths, server, tool, args)
	return err
}

func toolText(res *mcp.CallToolResult) string {
	var parts []string
	for _, c := range res.Content {
		if t, ok := c.(*mcp.TextContent); ok {
			parts = append(parts, t.Text)
		}
	}
	return strings.Join(parts, " ")
}

// recordMCPResult keeps what a scripted tool call returned, as <dir>/mcp-<tool>-<n>.json.
func recordMCPResult(dir, tool string, res *mcp.CallToolResult) {
	var v any = res.StructuredContent
	if res.IsError {
		v = map[string]any{"isError": true, "text": toolText(res)}
	} else if v == nil {
		v = res.Content
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return
	}
	n := nextCount(dir, "mcp-"+tool)
	_ = os.WriteFile(filepath.Join(dir, fmt.Sprintf("mcp-%s-%d.json", tool, n)), raw, 0o644)
}

type echoArgs struct {
	Text string `json:"text" jsonschema:"Text to echo back."`
}

type noArgs struct{}

// runFakeMCP serves a stdio MCP server with two tools, for tests of user MCP servers.
func runFakeMCP() int {
	srv := mcp.NewServer(&mcp.Implementation{Name: "fake-mcp", Version: "1"}, nil)
	mcp.AddTool(srv, &mcp.Tool{Name: "echo", Description: "Echo the text back.\nSecond line."},
		func(_ context.Context, _ *mcp.CallToolRequest, a echoArgs) (*mcp.CallToolResult, any, error) {
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: a.Text}}}, nil, nil
		})
	mcp.AddTool(srv, &mcp.Tool{Name: "ping", Description: "Answer pong."},
		func(_ context.Context, _ *mcp.CallToolRequest, _ noArgs) (*mcp.CallToolResult, any, error) {
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "pong"}}}, nil, nil
		})
	if err := srv.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		fmt.Fprintln(os.Stderr, "fake-mcp:", err)
		return 1
	}
	return 0
}
