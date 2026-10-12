package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory"
)

const (
	finalizeBaseTimeout = 5 * time.Minute
	finalizeBatchTime   = 45 * time.Second
	finalizeMaxTimeout  = 45 * time.Minute
	finalizeBaseBudget  = 1.00
	finalizeBatchBudget = 0.15
	finalizeMaxBudget   = 5.00
	mcpServerName       = "kira-memory"
)

var finalizeTools = []string{
	"mcp__" + mcpServerName + "__store_memory",
	"mcp__" + mcpServerName + "__search_memories",
	"mcp__" + mcpServerName + "__memory_history",
}

const finalizeSchema = `{
  "type": "object", "additionalProperties": false, "required": ["unresolved", "dropped"],
  "properties": {
    "unresolved": {"type": "array", "items": {
      "type": "object", "additionalProperties": false, "required": ["fact", "questions"],
      "properties": {"fact": {"type": "string"}, "questions": {"type": "array", "items": {"type": "string"}}}}},
    "dropped": {"type": "array", "items": {
      "type": "object", "additionalProperties": false, "required": ["fact", "why"],
      "properties": {"fact": {"type": "string"}, "why": {"type": "string"}}}}
  }
}`

type finalizeDoc struct {
	Path   string `json:"path"`
	Title  string `json:"title"`
	Chunks int    `json:"chunks"`
}

type finalizeWire struct {
	Document finalizeDoc `json:"document"`
	Facts    []FinalFact `json:"facts"`
}

// mcpConfig names the one MCP server the finalize agent may use: this binary in import mode, so
// every memory it stores is attributed to the file.
func mcpConfig(exe, home, fileID string, extraEnv map[string]string) string {
	env := map[string]string{"KIRA_MEMORY_HOME": home}
	for k, v := range extraEnv {
		env[k] = v
	}
	raw, _ := json.Marshal(map[string]any{"mcpServers": map[string]any{mcpServerName: map[string]any{
		"command": exe,
		"args":    []string{"memory-mcp", "--import-ref", fileID},
		"env":     env,
	}}})
	return string(raw)
}

func finalizeLimits(facts int) (time.Duration, string) {
	batches := math.Ceil(float64(facts) / factsPerBatch)
	timeout := min(finalizeBaseTimeout+time.Duration(batches)*finalizeBatchTime, finalizeMaxTimeout)
	budget := min(finalizeBaseBudget+finalizeBatchBudget*batches, finalizeMaxBudget)
	return timeout, fmt.Sprintf("%.2f", budget)
}

func (a ClaudeAgent) Finalize(ctx context.Context, in FinalizeInput) (FinalizeOutput, error) {
	input, err := json.Marshal(finalizeWire{
		Document: finalizeDoc{Path: in.Path, Title: in.Title, Chunks: in.ChunkCount}, Facts: in.Facts,
	})
	if err != nil {
		return FinalizeOutput{}, err
	}
	timeout, budget := finalizeLimits(len(in.Facts))
	res, err := a.Runner.RunResult(ctx, memory.Call{
		System: llmprompts.MemoryImportFinalizeSystem.Text(a.prompts(), llmprompts.FinalizeVars{MaxItems: memory.MaxItems, MaxReason: memory.MaxReasonLen}), Input: string(input), Schema: json.RawMessage(finalizeSchema),
		MCPConfig: mcpConfig(a.Executable, a.Home, in.FileID, a.Env), AllowedTools: finalizeTools,
		Timeout: timeout, Budget: budget,
	})
	out := FinalizeOutput{CostUSD: res.CostUSD}
	if err != nil {
		return out, err
	}
	var parsed struct {
		Unresolved []UnresolvedFact
		Dropped    []DroppedFact
	}
	if err := json.Unmarshal(res.Output, &parsed); err != nil {
		return out, memory.ErrClaudeOutput
	}
	out.Unresolved, out.Dropped = parsed.Unresolved, parsed.Dropped
	return out, nil
}
