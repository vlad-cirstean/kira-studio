package memory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/internal/toolexec"
)

var (
	ErrClaudeNotFound = errors.New("Claude Code CLI not found. Install it, then retry.")
	ErrClaudeAuth     = errors.New("Claude Code is not logged in. Run `claude` once to log in.")
	ErrClaudeBudget   = errors.New("Claude Code call exceeded its cost budget.")
	ErrClaudeTimeout  = errors.New("Claude Code call timed out.")
	ErrClaudeOutput   = errors.New("Claude Code returned output the memory store could not use.")
	ErrClaudeOutdated = errors.New("Claude Code CLI is too old for the memory store. Update Claude Code, then retry.")
)

const (
	claudeModel      = "sonnet"
	claudeCallBudget = "0.50"
	claudeTimeout    = 120 * time.Second
)

// Call is one isolated structured Claude Code request.
type Call struct {
	System string          // our system prompt
	Input  string          // JSON document, sent on stdin
	Schema json.RawMessage // --json-schema
}

// Runner runs one Call and returns the structured_output object.
type Runner interface {
	Run(ctx context.Context, c Call) (json.RawMessage, error)
}

// CLIRunner drives the `claude` CLI headless with every source of ambient context switched off:
// only our system prompt and the stdin document are visible to the model.
type CLIRunner struct {
	lookPath func(string) (string, error)
	stat     func(string) (os.FileInfo, error)
}

func NewCLIRunner() *CLIRunner {
	return &CLIRunner{lookPath: exec.LookPath, stat: os.Stat}
}

// inheritedSessionEnv would leak the calling Claude Code session's context into the child or nest
// it. Auth and provider variables are deliberately kept: an allowlist would silently break
// Bedrock/Vertex/proxy setups.
var inheritedSessionEnv = []string{
	"CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION",
	"CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD", "CLAUDE_ADDITIONAL_DIRECTORIES", "CLAUDE_PID",
	"CLAUDE_CODE_SSE_PORT",
}

func scrubbedEnv(environ []string) []string {
	out := make([]string, 0, len(environ))
	for _, kv := range environ {
		name, _, _ := strings.Cut(kv, "=")
		drop := false
		for _, d := range inheritedSessionEnv {
			if name == d {
				drop = true
				break
			}
		}
		if !drop {
			out = append(out, kv)
		}
	}
	return out
}

// claudeArgs is the isolation contract. Not --bare: it forces ANTHROPIC_API_KEY auth and never
// reads OAuth/keychain, which breaks a subscription login.
func claudeArgs(c Call) []string {
	return []string{
		"-p", "--model", claudeModel,
		"--safe-mode", "--setting-sources", "", "--strict-mcp-config", "--tools", "",
		"--disable-slash-commands", "--no-session-persistence", "--permission-prompts", "none",
		"--output-format", "json", "--json-schema", string(c.Schema),
		"--system-prompt", c.System, "--max-budget-usd", claudeCallBudget,
	}
}

type claudeResult struct {
	Subtype          string          `json:"subtype"`
	IsError          bool            `json:"is_error"`
	Result           string          `json:"result"`
	StructuredOutput json.RawMessage `json:"structured_output"`
}

func (r *CLIRunner) Run(ctx context.Context, c Call) (json.RawMessage, error) {
	path, _, found := toolexec.Locate(r.lookPath, r.stat, "claude", toolexec.ClaudeCandidates())
	if !found {
		return nil, ErrClaudeNotFound
	}
	dir, err := os.MkdirTemp("", "kira-memory-*")
	if err != nil {
		return nil, fmt.Errorf("memory: temp dir: %w", err)
	}
	defer os.RemoveAll(dir)

	runCtx, cancel := context.WithTimeout(ctx, claudeTimeout)
	defer cancel()
	out, runErr := toolexec.RunIO(runCtx, path, claudeArgs(c), dir, scrubbedEnv(os.Environ()), []byte(c.Input))
	if runErr != nil && runCtx.Err() != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrClaudeTimeout
	}
	return parseClaudeResult(out, runErr)
}

func parseClaudeResult(out []byte, runErr error) (json.RawMessage, error) {
	var res claudeResult
	parsed := json.Unmarshal(out, &res) == nil
	if parsed && res.Subtype == "error_max_budget_usd" {
		return nil, ErrClaudeBudget
	}
	if runErr != nil || (parsed && res.IsError) {
		detail := res.Result
		var execErr *toolexec.ExecError
		if errors.As(runErr, &execErr) {
			detail += " " + execErr.Stderr
		}
		return nil, classifyFailure(detail, runErr)
	}
	if !parsed || len(res.StructuredOutput) == 0 || string(res.StructuredOutput) == "null" {
		return nil, ErrClaudeOutput
	}
	return res.StructuredOutput, nil
}

func classifyFailure(detail string, runErr error) error {
	low := strings.ToLower(detail)
	switch {
	case strings.Contains(low, "unknown option") || strings.Contains(low, "unknown flag"):
		return ErrClaudeOutdated
	case strings.Contains(low, "login") || strings.Contains(low, "log in") || strings.Contains(low, "api key") ||
		strings.Contains(low, "authenticat") || strings.Contains(low, "oauth"):
		return ErrClaudeAuth
	}
	msg := strings.TrimSpace(detail)
	if msg == "" && runErr != nil {
		msg = runErr.Error()
	}
	return fmt.Errorf("Claude Code failed: %s", toolexec.FirstLineBounded(msg, 300))
}
