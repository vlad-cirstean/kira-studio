package scriptruns

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/scripts"
)

// maxSmartRuns is how many headless smart runs go at once.
const maxSmartRuns = 3

// RunArgs is what the run dialog sends to Preview and Start.
type RunArgs struct {
	ScriptID string              `json:"scriptId"`
	Params   map[string][]string `json:"params"`
	// Prompt is a one-off prompt body for this run, never saved; nil uses the saved body.
	Prompt *string `json:"prompt"`
	// TaskID and BranchID run the script for an ADE task and branch (Kira Space); "" for none.
	TaskID   string `json:"taskId"`
	BranchID string `json:"branchId"`
}

// EnvVar is one variable the run gets. A secret's Value is empty here. FromVar names the param the
// value comes from, "" for a fixed one.
type EnvVar struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	Secret  bool   `json:"secret"`
	FromVar string `json:"fromVar"`
}

// Preview is what a run would do, exactly as Start does it.
type Preview struct {
	Kind string `json:"kind"`
	// Missing lists required params without a value.
	Missing []string `json:"missing"`
	// Blocker, when set, says why Run is disabled.
	Blocker string      `json:"blocker"`
	Dir     scripts.Dir `json:"dir"`
	// Body is the saved prompt template; a one-off edit starts from it.
	Body string `json:"body"`
	// Prompt is the body being used, resolved, as parts.
	Prompt []scripts.Part `json:"prompt"`
	// Suffix is what Kira adds after the prompt.
	Suffix       string   `json:"suffix"`
	Env          []EnvVar `json:"env"`
	Command      string   `json:"command"`
	Model        string   `json:"model"`
	MaxBudgetUSD float64  `json:"maxBudgetUsd"`
	Timeout      string   `json:"timeout"`
	Tools        []string `json:"tools"`
	Allowed      []string `json:"allowedTools"`
	MCP          []string `json:"mcpServers"`
	Hash         string   `json:"hash"`
	// Needs lists what to pick before the run can resolve; ADE is the task and branch it resolved, nil without a task.
	Needs Needs   `json:"needs"`
	ADE   *RunADE `json:"ade"`
}

// StartArgs is RunArgs plus the hash of the preview the user confirmed.
type StartArgs struct {
	RunArgs
	Hash string `json:"hash"`
}

// TerminalStart tells the window how to open a normal script's terminal tab.
type TerminalStart struct {
	Token string `json:"token"`
	Cwd   string `json:"cwd"`
}

// Started is Start's answer: a smart run's id, or the terminal a normal script opens.
type Started struct {
	RunID    string         `json:"runId"`
	Terminal *TerminalStart `json:"terminal"`
}

type planned struct {
	script  scripts.CustomScript
	dir     scripts.Dir
	params  []RunParam
	envList []string
	// sent is the full prompt text a smart run sends: the resolved body, then the suffix.
	sent    string
	smart   scripts.Smart
	mcp     []string
	preview Preview
	// release drops the board's worktree claim a smart run holds; nil when none.
	release func()
}

func (s *Service) getenv(k string) string {
	if s.Getenv != nil {
		return s.Getenv(k)
	}
	return os.Getenv(k)
}

// plan resolves a run the one way Preview shows it and Start executes it.
//
// claimed says the caller already holds the worktree claim, so the busy check skips it.
func (s *Service) plan(args RunArgs, claimed bool) (*planned, error) {
	rec, err := s.Scripts.Get(args.ScriptID)
	if err != nil {
		return nil, ipcerr.InternalErr(err)
	}
	if rec == nil {
		return nil, ipcerr.NotFound("script not found")
	}
	vals, missing, err := scripts.ParamValues(rec.Params, args.Params)
	if err != nil {
		return nil, ipcerr.New("E_INVALID", err.Error())
	}
	p := &planned{script: *rec, dir: scripts.ResolveDir(*rec, s.Home)}
	pv := Preview{
		Kind: rec.Kind, Missing: nonNilStrings(missing), Dir: p.dir, Env: []EnvVar{}, MCP: []string{}, Tools: []string{},
		Allowed: []string{}, Prompt: []scripts.Part{}, Needs: Needs{Tasks: []TaskChoice{}, Branches: []BranchChoice{}},
	}
	pv.Blocker = p.dir.Blocker
	rendered := map[string]string{}
	for _, v := range vals {
		pv.Env = append(pv.Env, EnvVar{Name: scripts.EnvName(v.Name), Value: ifNot(v.Secret, v.Env), Secret: v.Secret, FromVar: v.Name})
		p.envList = append(p.envList, scripts.EnvName(v.Name)+"="+v.Env)
		shown := v.Env
		if v.Secret {
			shown = scripts.SecretMask
		} else {
			rendered[v.Name] = v.Rendered
		}
		p.params = append(p.params, RunParam{Name: v.Name, Value: shown})
	}
	if rec.Kind != scripts.KindSmart {
		pv.Command = rec.Command
		if err := s.planADE(args, p, &pv, rec.Command, rendered, claimed); err != nil {
			return nil, err
		}
		p.preview = finishPreview(pv, p)
		return p, nil
	}

	smart := *rec.Smart
	p.smart = smart
	body := rec.Command
	pv.Body = body
	if args.Prompt != nil {
		body = strings.TrimSpace(*args.Prompt)
		if blocker := checkPromptEdit(body, rec.Params); blocker != "" && pv.Blocker == "" {
			pv.Blocker = blocker
		}
	}
	if err := s.planADE(args, p, &pv, body, rendered, claimed); err != nil {
		return nil, err
	}
	pv.Prompt = scripts.Compose(body, rendered)
	pv.Suffix = claudeheadless.ScriptReportSuffix
	extra := []string{claudeheadless.FinishStepTool}
	if args.TaskID != "" {
		pv.Suffix = claudeheadless.SpaceSuffix + "\n\n" + pv.Suffix
		extra = append(append(extra, claudeheadless.RunOutcomeTool), claudeheadless.SpaceToolNames...)
	}
	p.sent = scripts.PlainText(pv.Prompt) + "\n\n" + pv.Suffix
	pv.Model, pv.MaxBudgetUSD, pv.Timeout = smart.Model, smart.MaxBudgetUSD, smart.Timeout
	pv.Tools, pv.Allowed = scripts.ToolArgs(smart, extra)
	for _, c := range smart.MCP {
		pv.MCP = append(pv.MCP, c.Server)
	}
	p.mcp = pv.MCP
	if pv.Blocker == "" {
		pv.Blocker = s.smartBlocker(pv.MCP)
	}
	p.preview = finishPreview(pv, p)
	return p, nil
}

func ifNot(secret bool, v string) string {
	if secret {
		return ""
	}
	return v
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// checkPromptEdit answers why a one-off prompt cannot run, "" when it can.
func checkPromptEdit(body string, params []scripts.Param) string {
	if body == "" {
		return "the prompt is empty"
	}
	if utf8.RuneCountInString(body) > scripts.MaxPrompt {
		return fmt.Sprintf("the prompt is longer than %d characters", scripts.MaxPrompt)
	}
	for _, p := range params {
		if p.Secret && containsVarName(body, p.Name) {
			return "secret param " + p.Name + " cannot be used in the prompt"
		}
	}
	return ""
}

func containsVarName(text, name string) bool {
	for _, used := range scripts.VarsUsed(text, []scripts.Param{{Name: name}}) {
		if used == name {
			return true
		}
	}
	return false
}

// smartBlocker answers why a smart run cannot start now: the run cap, or a user MCP server that is gone.
func (s *Service) smartBlocker(mcp []string) string {
	s.mu.Lock()
	running := len(s.smart)
	s.mu.Unlock()
	if running >= maxSmartRuns {
		return fmt.Sprintf("%d smart scripts are running: wait for one to finish", maxSmartRuns)
	}
	if len(mcp) == 0 {
		return ""
	}
	have, err := claudeheadless.UserServers(s.getenv)
	if err != nil {
		return err.Error()
	}
	for _, name := range mcp {
		found := false
		for _, h := range have {
			found = found || h.Name == name
		}
		if !found {
			return claudeheadless.ErrServerGone{Name: name}.Error()
		}
	}
	return ""
}

func finishPreview(pv Preview, p *planned) Preview {
	pv.Hash = hashOf(pv, p)
	return pv
}

// hashOf fingerprints what the user confirmed: kind, folder, what is sent, and how it runs.
func hashOf(pv Preview, p *planned) string {
	type envKV struct{ Name, Value string }
	fixed := make([]envKV, 0, len(pv.Env))
	for _, e := range pv.Env {
		fixed = append(fixed, envKV{e.Name, e.Value})
	}
	adeKey := ""
	if pv.ADE != nil {
		adeKey = pv.ADE.TaskID + "/" + pv.ADE.BranchID
	}
	b, _ := json.Marshal(struct {
		Kind, Cwd, Mode, Ade, Sent, Model, Timeout, Command string
		Budget                                              float64
		Tools, Allowed, MCP                                 []string
		Env                                                 []envKV
	}{pv.Kind, pv.Dir.Path, pv.Dir.Mode, adeKey, p.sent, pv.Model, pv.Timeout, pv.Command, pv.MaxBudgetUSD, pv.Tools, pv.Allowed, pv.MCP, fixed})
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// Preview resolves a run without starting anything.
func (s *Service) Preview(args RunArgs) (Preview, error) {
	p, err := s.plan(args, false)
	if err != nil {
		return Preview{}, err
	}
	return p.preview, nil
}

// Start runs what Preview showed. A script that changed since the preview is refused.
func (s *Service) Start(args StartArgs) (Started, error) {
	p, err := s.plan(args.RunArgs, false)
	if err != nil {
		return Started{}, err
	}
	if p.dir.Mode == scripts.DirModeWorktree && p.preview.Blocker == "" && len(p.preview.Missing) == 0 &&
		(p.script.Kind == scripts.KindSmart || p.dir.Pending) {
		if p, err = s.claimWorktree(args.RunArgs, p); err != nil {
			return Started{}, err
		}
	}
	started, err := s.startPlanned(p, args.Hash)
	if err != nil && p.release != nil {
		p.release()
	}
	return started, err
}

// claimWorktree creates the branch's missing worktree and, for a smart run, keeps the board's claim
// on it. A normal script only needs the worktree to exist, so its claim is dropped at once. The run
// is planned again against the created worktree.
func (s *Service) claimWorktree(args RunArgs, p *planned) (*planned, error) {
	release, err := s.ADE.ClaimWorktree(context.Background(), p.preview.ADE.BranchID, p.script.Name)
	if err != nil {
		return nil, ipcerr.New("E_INVALID", err.Error())
	}
	if p.script.Kind != scripts.KindSmart {
		release()
		return s.plan(args, false)
	}
	np, err := s.plan(args, true)
	if err != nil {
		release()
		return nil, err
	}
	np.release = release
	return np, nil
}

func (s *Service) startPlanned(p *planned, hash string) (Started, error) {
	if p.preview.Hash != hash {
		return Started{}, ipcerr.New("E_CONFLICT", "the script changed since the preview: check it again")
	}
	if p.preview.Blocker != "" {
		return Started{}, ipcerr.New("E_INVALID", p.preview.Blocker)
	}
	if len(p.preview.Missing) > 0 {
		return Started{}, ipcerr.New("E_INVALID", "fill in "+strings.Join(p.preview.Missing, ", "))
	}
	if p.script.Kind == scripts.KindSmart {
		return s.startSmart(p)
	}
	return s.startTerminal(p)
}
