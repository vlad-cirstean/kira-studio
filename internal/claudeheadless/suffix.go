package claudeheadless

import "github.com/kirathecat/kira-studio/internal/llmprompts"

// FinishVars is the template data of the finish instruction for a step's results.
func FinishVars(results []ResultSpec) llmprompts.FinishVars {
	out := llmprompts.FinishVars{Implicit: IsImplicit(results), Results: make([]llmprompts.ResultVar, len(results))}
	for i, r := range results {
		out.Results[i] = llmprompts.ResultVar{ID: r.ID, Description: r.Description, OK: r.OK}
	}
	return out
}

// FinishInstruction is the finish instruction that ends every agent step prompt. It is not in the
// workflow YAML and cannot be removed.
func FinishInstruction(src llmprompts.Source, results []ResultSpec) string {
	return llmprompts.HeadlessFinishStepSuffix.Text(src, FinishVars(results))
}

// FinishStepTool is the allowed-tools name of the finish_step MCP tool: server "kira-ade", tool "finish_step".
const FinishStepTool = "mcp__" + ServerName + "__finish_step"

// ServerName is the MCP server name in the run's --mcp-config.
const ServerName = "kira-ade"

// SpaceNote goes before the finish instruction when the workflow turns the Kira Space tools on.
func SpaceNote(src llmprompts.Source) string {
	return llmprompts.HeadlessSpaceSuffix.Text(src, llmprompts.NoVars{})
}

// RunOutcomeTool is the allowed-tools name of the run_outcome MCP tool.
const RunOutcomeTool = "mcp__" + ServerName + "__run_outcome"

// RebaseReport ends every rebase run's prompt, edited ones included.
func RebaseReport(src llmprompts.Source) string {
	return llmprompts.HeadlessRebaseReportSuffix.Text(src, llmprompts.NoVars{})
}

// ScriptReport ends every smart script prompt, one-off edits included.
func ScriptReport(src llmprompts.Source) string {
	return llmprompts.HeadlessScriptReportSuffix.Text(src, llmprompts.NoVars{})
}
