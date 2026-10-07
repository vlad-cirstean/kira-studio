package adeagent

// FinishStepSuffix ends every agent step prompt (SPEC2 section 5.1.2). It is not in the workflow
// YAML and cannot be removed.
const FinishStepSuffix = `When this step is done, call the finish_step tool with status "done" and a one-line summary. If it failed, call it with status "failed" and say what failed. If you need a decision from me, call it with status "needs_input" and your question.`

// FinishStepTool is the allowed-tools name of the finish_step MCP tool: server "kira-ade", tool "finish_step".
const FinishStepTool = "mcp__" + ServerName + "__finish_step"

// ServerName is the MCP server name in the run's --mcp-config.
const ServerName = "kira-ade"

// SpaceSuffix goes before FinishStepSuffix when the workflow turns the Kira Space tools on.
const SpaceSuffix = `Kira Space tools are available: task_info, declare_repos, request_branch, branch_status. Create branches and worktrees only through request_branch.`
