package claudeheadless

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// SpaceToolNames are the allowed-tools names of the Kira Space tools; the headless run and a TUI
// launch pass them next to finish_step when the workflow turns the tools on.
var SpaceToolNames = []string{
	"mcp__" + ServerName + "__task_info",
	"mcp__" + ServerName + "__declare_repos",
	"mcp__" + ServerName + "__request_branch",
	"mcp__" + ServerName + "__branch_status",
}

const (
	spaceInstructions = "Kira Space tools for this task. Call task_info first. Declare the repos the work touches with " +
		"declare_repos before branching. Create branches only with request_branch, never with git branch or git worktree. " +
		"A new worktree may still be preparing: call branch_status (it can wait) before editing in it."
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
	Stage      string           `json:"stage"`
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
	Repos []string `json:"repos" jsonschema:"Repos to add to the task: nickname, name or code repo id from task_info registered. 1 to 20."`
}

type requestBranchArgs struct {
	Repo string `json:"repo" jsonschema:"A repo on the task: nickname, name or code repo id."`
	Name string `json:"name" jsonschema:"The branch name to create, for example feat/login-form."`
}

type branchStatusArgs struct {
	Repo        string `json:"repo" jsonschema:"A repo on the task: nickname, name or code repo id."`
	WaitSeconds int    `json:"waitSeconds,omitempty" jsonschema:"Seconds to wait for the worktree setup to finish, 0 to 600. Default 0."`
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
	slog.Warn("claudeheadless: space tool", "scope", "ade", "tool", tool, "err", err)
	return toolError("Kira Space could not complete that. Try again, or ask the user.")
}

func (s *Server) addSpaceTools(srv *mcp.Server) {
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "task_info",
		Description: "The Kira Space task you work on: title, Jira key, workflow, stage, the repos and branches it has, and the repos registered in Kira Space.",
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
		Name: "declare_repos",
		Description: "Add repos to the task. Only repos registered in Kira Space can be added; an unknown repo is refused, " +
			"ask the user to import it from the Git module. Never removes a repo.",
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
		Name: "request_branch",
		Description: "Create a branch and its worktree for a repo of the task. Returns at once: the worktree's prepare script may " +
			"still be running, so call branch_status before working there.",
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
		Description: "The worktree and setup state of a branch of the task. With waitSeconds, waits until the setup is no longer running.",
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
