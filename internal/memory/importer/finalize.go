package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

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

const finalizePrompt = `You store the facts extracted from one document into a long-term memory store through the kira-memory tools, then report the facts you did not store. Output only the schema when you are done.

` + memory.DataHygiene + `

Input: "document" (path, title, number of chunks) and "facts": atomic facts extracted separately from each chunk, in document order. Each has an id, its chunk, its section, an evidence quote and, when the chunk left something open, "unresolved".

Work through the facts:
1. The chunks were read independently, so facts overlap and repeat. Merge duplicates and near-duplicates into one fact.
2. Resolve each fact marked unresolved using the other facts of this document, then rewrite it as a standalone fact. A fact that stays ambiguous is not stored: list it in "unresolved" with the open question.
3. Drop a fact that is not durable (trivia, an example, time-bound, navigation): list it in "dropped" with why. Drop any secret (password, token, API key, private key) and never store it.
4. Store the rest with the store_memory tool, at most 20 items per call, with author "agent". Write each item's fact standalone. Write each item's reason exactly as: Stated in <document path>, <section>: "<evidence>" (at most 2000 characters).
5. store_memory can challenge items with questions; a challenged call stores nothing. Answer the questions through "clarifications" using only what this document's facts state, never assumption or general knowledge. When the document cannot answer, remove that item from the call, call again, and list the fact in "unresolved" with the questions the store asked.
6. store_memory already reconciles new facts against stored ones. Use search_memories only when it helps you word a fact.
7. Stop when every input fact is stored, merged into another, dropped or listed unresolved. Report only the facts you did not store.`

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
		System: finalizePrompt, Input: string(input), Schema: json.RawMessage(finalizeSchema),
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
