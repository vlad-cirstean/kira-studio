package agentmcp

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
)

const (
	maxDeclareRepos = 20
	maxWaitSeconds  = 600
)

// ToolError is a failure the agent can act on; its text is returned to the agent verbatim. Any other
// error reaches the agent as a generic failure.
type ToolError string

func (e ToolError) Error() string { return string(e) }

// SetupInfo is a worktree's prepare-script state: none (no worktree yet), running, ready or failed.
type SetupInfo struct {
	State string `json:"state"`
	Note  string `json:"note"`
}

// TaskRepo is a repo on the task and its branch, when created.
type TaskRepo struct {
	Repo       string    `json:"repo"`
	CodeRepoID string    `json:"codeRepoId"`
	Branch     *string   `json:"branch"`
	Worktree   string    `json:"worktree"`
	Setup      SetupInfo `json:"setup"`
}

// RegisteredRepo is a repo imported into Kira Space; only these can be declared.
type RegisteredRepo struct {
	Name       string `json:"name"`
	Nickname   string `json:"nickname"`
	CodeRepoID string `json:"codeRepoId"`
	Path       string `json:"path"`
}

// TaskInfo is the task as an agent sees it.
type TaskInfo struct {
	Title      string           `json:"title"`
	JiraKey    string           `json:"jiraKey"`
	Workflow   string           `json:"workflow"`
	Step       string           `json:"step"`
	Repos      []TaskRepo       `json:"repos"`
	Registered []RegisteredRepo `json:"registered"`
}

// BranchInfo is one branch of the task and the state of its worktree.
type BranchInfo struct {
	Repo     string    `json:"repo"`
	Branch   string    `json:"branch"`
	Worktree string    `json:"worktree"`
	Setup    SetupInfo `json:"setup"`
	Next     string    `json:"next"`
}

// SpaceTools is what the Kira Space tools call; *ade.TaskBoard implements it. Every method acts on
// taskID only.
type SpaceTools interface {
	TaskInfo(ctx context.Context, taskID string) (TaskInfo, error)
	DeclareRepos(ctx context.Context, taskID string, repos []string) (TaskInfo, error)
	RequestBranch(ctx context.Context, taskID, repo, name string) (BranchInfo, error)
	BranchStatus(ctx context.Context, taskID, repo string, wait time.Duration) (BranchInfo, error)
}

type declareArgs struct {
	Repos []string `json:"repos"`
}

type requestBranchArgs struct {
	Repo string `json:"repo"`
	Name string `json:"name"`
}

type branchStatusArgs struct {
	Repo        string `json:"repo"`
	WaitSeconds int    `json:"waitSeconds,omitempty"`
}

type noArgs struct{}

// spaceTask resolves the Space grant behind a call; every Space tool acts on that task alone.
func (s *Server) spaceTask(req *mcp.CallToolRequest) (string, *mcp.CallToolResult) {
	var g Grant
	var ok bool
	if req.Extra != nil {
		g, ok = s.grant(req.Extra.TokenInfo)
	}
	if !ok || !g.Space || g.TaskID == "" {
		return "", toolError("Kira Space tools are not available for this session.")
	}
	return g.TaskID, nil
}

// fail turns an engine error into a tool result: a ToolError verbatim, anything else generic.
func fail(tool string, err error) *mcp.CallToolResult {
	var te ToolError
	if errors.As(err, &te) {
		return toolError(te.Error())
	}
	slog.Warn("agentmcp: space tool", "scope", "ade", "tool", tool, "err", err)
	return toolError("Kira Space could not complete that. Try again, or ask the user.")
}

func (s *Server) addSpaceTools(srv *mcp.Server) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "task_info",
		Description: llmprompts.HeadlessToolTaskInfo.Text(s.prompts, llmprompts.NoVars{}),
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ noArgs) (*mcp.CallToolResult, TaskInfo, error) {
		task, bad := s.spaceTask(req)
		if bad != nil {
			return bad, TaskInfo{}, nil
		}
		info, err := s.space.TaskInfo(ctx, task)
		if err != nil {
			return fail("task_info", err), TaskInfo{}, nil
		}
		return nil, info, nil
	})
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "declare_repos",
		Description: llmprompts.HeadlessToolDeclareRepos.Text(s.prompts, llmprompts.NoVars{}),
		InputSchema: llmprompts.InputSchema[declareArgs](s.prompts, llmprompts.HeadlessToolDeclareRepos.ID(), map[string]any{
			"repos": llmprompts.MaxVars{Max: maxDeclareRepos},
		}),
	}, func(ctx context.Context, req *mcp.CallToolRequest, args declareArgs) (*mcp.CallToolResult, TaskInfo, error) {
		task, bad := s.spaceTask(req)
		if bad != nil {
			return bad, TaskInfo{}, nil
		}
		if n := len(args.Repos); n == 0 || n > maxDeclareRepos {
			return toolError("repos needs 1 to 20 entries."), TaskInfo{}, nil
		}
		info, err := s.space.DeclareRepos(ctx, task, args.Repos)
		if err != nil {
			return fail("declare_repos", err), TaskInfo{}, nil
		}
		return nil, info, nil
	})
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "request_branch",
		Description: llmprompts.HeadlessToolRequestBranch.Text(s.prompts, llmprompts.NoVars{}),
		InputSchema: llmprompts.InputSchema[requestBranchArgs](s.prompts, llmprompts.HeadlessToolRequestBranch.ID(), nil),
	}, func(ctx context.Context, req *mcp.CallToolRequest, args requestBranchArgs) (*mcp.CallToolResult, BranchInfo, error) {
		task, bad := s.spaceTask(req)
		if bad != nil {
			return bad, BranchInfo{}, nil
		}
		info, err := s.space.RequestBranch(ctx, task, args.Repo, args.Name)
		if err != nil {
			return fail("request_branch", err), BranchInfo{}, nil
		}
		return nil, info, nil
	})
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "branch_status",
		Description: llmprompts.HeadlessToolBranchStatus.Text(s.prompts, llmprompts.NoVars{}),
		InputSchema: llmprompts.InputSchema[branchStatusArgs](s.prompts, llmprompts.HeadlessToolBranchStatus.ID(), map[string]any{
			"waitSeconds": llmprompts.MaxVars{Max: maxWaitSeconds},
		}),
	}, func(ctx context.Context, req *mcp.CallToolRequest, args branchStatusArgs) (*mcp.CallToolResult, BranchInfo, error) {
		task, bad := s.spaceTask(req)
		if bad != nil {
			return bad, BranchInfo{}, nil
		}
		if args.WaitSeconds < 0 || args.WaitSeconds > maxWaitSeconds {
			return toolError("waitSeconds must be 0 to 600."), BranchInfo{}, nil
		}
		info, err := s.space.BranchStatus(ctx, task, args.Repo, time.Duration(args.WaitSeconds)*time.Second)
		if err != nil {
			return fail("branch_status", err), BranchInfo{}, nil
		}
		return nil, info, nil
	})
}
