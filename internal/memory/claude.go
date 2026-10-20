package memory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/renameio/v2"

	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/harness/claude"
	"github.com/kirathecat/kira-studio/internal/toolexec"
)

var (
	ErrClaudeNotFound = errors.New("Claude Code CLI not found. Install it, then retry.")
	ErrClaudeAuth     = errors.New("Claude Code is not logged in. Run `claude` once to log in.")
	ErrClaudeBudget   = errors.New("Claude Code call exceeded its cost budget.")
	ErrClaudeMaxTurns = errors.New("Claude Code call hit its turn limit.")
	ErrClaudeTimeout  = errors.New("Claude Code call timed out.")
	ErrClaudeOutput   = errors.New("Claude Code returned output the memory store could not use.")
	ErrClaudeOutdated = errors.New("Claude Code CLI is too old for the memory store. Update Claude Code, then retry.")

	ErrClaudeRateLimited = errors.New("Claude Code is rate limited. Retry shortly.")
	ErrClaudeUsageLimit  = errors.New("Claude usage limit reached. Resume the import when it resets.")
)

const (
	claudeCallBudget = "0.50"
	claudeTimeout    = 120 * time.Second
)

// Call is one isolated structured Claude Code request.
type Call struct {
	System string          // our system prompt
	Input  string          // JSON document, sent on stdin
	Schema json.RawMessage // --json-schema
	// MCPConfig, when set, is an inline --mcp-config JSON naming the only MCP servers the call may
	// use; AllowedTools then lists the only tools it may call.
	MCPConfig    string
	AllowedTools []string
	Timeout      time.Duration // 0 means claudeTimeout
	Budget       string        // --max-budget-usd; empty means claudeCallBudget
	// Tools, when set, are the built-in tools the call may use (read-only file tools), confined to
	// its temp dir; Files seeds that dir. MaxTurns caps the tool loop (--max-turns); 0 leaves it off.
	Tools    []string
	Files    map[string][]byte
	MaxTurns int
}

// Runner runs one Call and returns the structured_output object.
type Runner interface {
	Run(ctx context.Context, c Call) (json.RawMessage, error)
}

// Result is a finished call: the structured_output plus what Claude Code reported spending.
type Result struct {
	Output  json.RawMessage
	CostUSD float64
	Turns   int
}

// CLIRunner drives the `claude` CLI headless with every source of ambient context switched off:
// only our system prompt and the stdin document are visible to the model.
type CLIRunner struct {
	lookPath func(string) (string, error)
	stat     func(string) (os.FileInfo, error)
	models   ModelSource
}

// ModelSource returns the model alias for the next call; nil means claude.Catalog.Default.
type ModelSource func() (string, error)

func NewCLIRunner(models ModelSource) *CLIRunner {
	return &CLIRunner{lookPath: exec.LookPath, stat: os.Stat, models: models}
}

// model resolves per call, so a settings change applies to the next call in a running process.
func (r *CLIRunner) model() string {
	if r.models == nil {
		return claude.Catalog.Default
	}
	m, err := r.models()
	if err != nil {
		slog.Warn("memory: read claude model, using default", "err", err)
		return claude.Catalog.Default
	}
	if !claude.Catalog.Valid(m) {
		slog.Warn("memory: invalid claude model, using default", "model", m)
		return claude.Catalog.Default
	}
	return m
}

// claudeArgs is the isolation contract. Not --bare: it forces ANTHROPIC_API_KEY auth and never
// reads OAuth/keychain, which breaks a subscription login.
func claudeArgs(model string, c Call) []string {
	budget := c.Budget
	if budget == "" {
		budget = claudeCallBudget
	}
	args := []string{"-p", "--model", model}
	if c.MCPConfig == "" && len(c.Tools) == 0 {
		args = append(args, "--safe-mode")
	}
	args = append(args, "--setting-sources", "", "--strict-mcp-config")
	if len(c.Tools) > 0 {
		// --restricted confines Read and Grep to the working dir and drops code-running tools. Probed in
		// P274: without it Read opens an absolute path outside cwd under --safe-mode. Not --safe-mode:
		// it is kept off for tool calls, as for MCP calls.
		tools := strings.Join(c.Tools, ",")
		args = append(args, "--restricted", "--tools", tools, "--allowedTools", tools)
		if c.MaxTurns > 0 {
			args = append(args, "--max-turns", strconv.Itoa(c.MaxTurns))
		}
	} else {
		args = append(args, "--tools", "")
	}
	if c.MCPConfig != "" {
		// --safe-mode disables --mcp-config servers too (measured in P211), so an MCP call runs
		// without it; --strict-mcp-config still keeps every other server out.
		args = append(args, "--mcp-config", c.MCPConfig, "--allowedTools", strings.Join(c.AllowedTools, ","))
	}
	return append(args,
		"--disable-slash-commands", "--no-session-persistence", "--permission-prompts", "none",
		"--output-format", "json", "--json-schema", string(c.Schema),
		"--system-prompt", c.System, "--max-budget-usd", budget)
}

type claudeResult struct {
	Subtype          string          `json:"subtype"`
	IsError          bool            `json:"is_error"`
	Result           string          `json:"result"`
	StructuredOutput json.RawMessage `json:"structured_output"`
	TotalCostUSD     float64         `json:"total_cost_usd"`
	NumTurns         int             `json:"num_turns"`
}

func (r *CLIRunner) Run(ctx context.Context, c Call) (json.RawMessage, error) {
	res, err := r.RunResult(ctx, c)
	return res.Output, err
}

// Available reports whether the claude CLI can be found.
func (r *CLIRunner) Available() error {
	if _, _, found := toolexec.Locate(r.lookPath, r.stat, "claude", toolexec.ClaudeCandidates()); !found {
		return ErrClaudeNotFound
	}
	return nil
}

// ClaudeAvailable is the Available probe without a runner.
func ClaudeAvailable() error { return NewCLIRunner(nil).Available() }

// RunResult is Run plus the cost and turn count Claude Code reports.
func (r *CLIRunner) RunResult(ctx context.Context, c Call) (Result, error) {
	path, _, found := toolexec.Locate(r.lookPath, r.stat, "claude", toolexec.ClaudeCandidates())
	if !found {
		return Result{}, ErrClaudeNotFound
	}
	dir, err := os.MkdirTemp("", "kira-memory-*")
	if err != nil {
		return Result{}, fmt.Errorf("memory: temp dir: %w", err)
	}
	defer os.RemoveAll(dir)
	for name, data := range c.Files {
		if err := renameio.WriteFile(filepath.Join(dir, filepath.Base(name)), data, 0o600); err != nil {
			return Result{}, fmt.Errorf("memory: seed temp dir: %w", err)
		}
	}

	timeout := c.Timeout
	if timeout <= 0 {
		timeout = claudeTimeout
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out, runErr := toolexec.RunIO(runCtx, path, claudeArgs(r.model(), c), dir, claudeheadless.ScrubSessionEnv(os.Environ()), []byte(c.Input))
	if runErr != nil && runCtx.Err() != nil {
		if ctx.Err() != nil {
			return Result{}, ctx.Err()
		}
		return Result{}, ErrClaudeTimeout
	}
	return parseClaudeResult(out, runErr)
}

func parseClaudeResult(out []byte, runErr error) (Result, error) {
	var res claudeResult
	parsed := json.Unmarshal(out, &res) == nil
	spent := Result{CostUSD: res.TotalCostUSD, Turns: res.NumTurns}
	if parsed && res.Subtype == "error_max_budget_usd" {
		return spent, ErrClaudeBudget
	}
	if parsed && res.Subtype == "error_max_turns" {
		return spent, ErrClaudeMaxTurns
	}
	if runErr != nil || (parsed && res.IsError) {
		detail := res.Result
		var execErr *toolexec.ExecError
		if errors.As(runErr, &execErr) {
			detail += " " + execErr.Stderr
		}
		return spent, classifyFailure(detail, runErr)
	}
	if !parsed || len(res.StructuredOutput) == 0 || string(res.StructuredOutput) == "null" {
		return spent, ErrClaudeOutput
	}
	spent.Output = res.StructuredOutput
	return spent, nil
}

func classifyFailure(detail string, runErr error) error {
	low := strings.ToLower(detail)
	switch {
	case strings.Contains(low, "unknown option") || strings.Contains(low, "unknown flag"):
		return ErrClaudeOutdated
	case strings.Contains(low, "login") || strings.Contains(low, "log in") || strings.Contains(low, "api key") ||
		strings.Contains(low, "authenticat") || strings.Contains(low, "oauth"):
		return ErrClaudeAuth
	case strings.Contains(low, "usage limit") || strings.Contains(low, "limit reached"):
		return ErrClaudeUsageLimit
	case strings.Contains(low, "rate limit") || strings.Contains(low, "rate_limit") || strings.Contains(low, "429") ||
		strings.Contains(low, "overloaded") || strings.Contains(low, "529"):
		return ErrClaudeRateLimited
	}
	msg := strings.TrimSpace(detail)
	if msg == "" && runErr != nil {
		msg = runErr.Error()
	}
	return fmt.Errorf("Claude Code failed: %s", toolexec.FirstLineBounded(msg, 300))
}
