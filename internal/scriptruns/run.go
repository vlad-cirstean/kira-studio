// Package scriptruns records every Automations execution: one row per run, live state, then the
// shared outcome. Both apps embed the bound half and own the table (script_runs).
package scriptruns

import "github.com/kirathecat/kira-studio/internal/runoutcome"

// Trigger says what started a run. Part 1 writes only TriggerTerminal; the table's CHECK reserves the rest.
type Trigger string

const (
	TriggerTerminal  Trigger = "terminal"
	TriggerManual    Trigger = "manual"
	TriggerADE       Trigger = "ade"
	TriggerScheduled Trigger = "scheduled"
)

// States are the outcome statuses plus Running.
const StateRunning = "running"

// Run mirrors packages/shared/domain/scriptRuns.ts's scriptRunSchema.
type Run struct {
	ID         string              `json:"id"`
	ScriptID   string              `json:"scriptId"`
	ScriptName string              `json:"scriptName"`
	Color      string              `json:"color"`
	Kind       string              `json:"kind"`
	Trigger    Trigger             `json:"trigger"`
	State      string              `json:"state"`
	TerminalID string              `json:"terminalId"`
	Cwd        string              `json:"cwd"`
	Command    string              `json:"command"`
	Outcome    *runoutcome.Outcome `json:"outcome"`
	CreatedAt  int64               `json:"createdAt"`
	StartedAt  *int64              `json:"startedAt"`
	FinishedAt *int64              `json:"finishedAt"`
}
