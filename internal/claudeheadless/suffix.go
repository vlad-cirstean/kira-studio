package claudeheadless

import "strings"

// FinishStepSuffix ends every agent step prompt (SPEC2 section 5.1.2). It is not in the workflow
// YAML and cannot be removed.
const FinishStepSuffix = `When this step is done, call the finish_step tool with status "done" and a one-line summary. If it failed, call it with status "failed" and say what failed and give the reason. If you need a decision from me, call it with status "needs_input" and your question.`

// FinishStepSuffixFor is the finish instruction for a step with results. The implicit pair gives
// FinishStepSuffix exactly. frontend ade/v2/board/runMessage.ts mirrors it.
func FinishStepSuffixFor(results []ResultSpec) string {
	if IsImplicit(results) {
		return FinishStepSuffix
	}
	parts := make([]string, len(results))
	for i, r := range results {
		kind := "not ok"
		if r.OK {
			kind = "ok"
		}
		parts[i] = r.ID + " (" + kind
		if r.Description != "" {
			parts[i] += ": " + r.Description
		}
		parts[i] += ")"
	}
	return "When this step ends, call the finish_step tool once with status set to one of: " + strings.Join(parts, ", ") +
		`. Add a one-line summary; for a not-ok status give the reason. If you need a decision from me, use status "needs_input" with your question.`
}

// FinishStepTool is the allowed-tools name of the finish_step MCP tool: server "kira-ade", tool "finish_step".
const FinishStepTool = "mcp__" + ServerName + "__finish_step"

// ServerName is the MCP server name in the run's --mcp-config.
const ServerName = "kira-ade"

// SpaceSuffix goes before FinishStepSuffix when the workflow turns the Kira Space tools on.
const SpaceSuffix = `Kira Space tools are available: task_info, declare_repos, request_branch, branch_status. Your working directory may be a repo root: read it, but change nothing there. Create branches and worktrees only through request_branch, with a name you choose, then work in the returned worktree.`

// RunOutcomeTool is the allowed-tools name of the run_outcome MCP tool.
const RunOutcomeTool = "mcp__" + ServerName + "__run_outcome"

// RebaseReportSuffix ends every rebase run's prompt, edited ones included.
const RebaseReportSuffix = `Run git only with the git tool: pass the worktree path from the list above and the words after git as args. There is no shell. When you are finished, call finish_step. status "done" only when every branch above is rebased and no rebase is in progress. status "failed" with reason, conflictedFiles, lastGitError and tried when you could not finish; leave a rebase in progress only when you could not resolve it, and say so. status "needs_input" with your question when you need a decision. Kira Space checks the result in git.`

// ScriptReportSuffix ends every smart script prompt, one-off edits included.
const ScriptReportSuffix = `When you are finished, call the finish_step tool with status "done" and a one-line summary. If you could not finish, call it with status "failed" and give the reason. If you need a decision, call it with status "needs_input" and your question.`
