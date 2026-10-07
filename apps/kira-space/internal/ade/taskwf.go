package ade

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// A task that has not started follows the live workflow file. Its first run, first session or first
// stage move snapshots the whole workflow; from then on every stage move reads the snapshot, so a
// later edit applies to new work only.

// workflowHash hashes the canonical JSON of a workflow, the encoding adeflow.Reader records.
func workflowHash(js []byte) string {
	sum := sha256.Sum256(js)
	return hex.EncodeToString(sum[:])
}

// taskWorkflow returns the workflow a task runs: its snapshot when it has started, else the live file.
func (b *TaskBoard) taskWorkflow(t model.AdeTask) (adewire.Workflow, bool) {
	if t.WorkflowJSON != "" {
		var wf adewire.Workflow
		if err := json.Unmarshal([]byte(t.WorkflowJSON), &wf); err != nil {
			slog.Warn("ade: unreadable workflow snapshot", "scope", "ade", "task", t.ID, "err", err)
			return adewire.Workflow{}, false
		}
		return wf, true
	}
	if t.WorkflowID == "" || b.deps.Workflows == nil {
		return adewire.Workflow{}, false
	}
	return b.deps.Workflows.Get(t.WorkflowID)
}

// snapshotWorkflow stores the effective workflow on a task that has none yet. The task mutex is held.
func (b *TaskBoard) snapshotWorkflow(t *model.AdeTask) error {
	if t.WorkflowID == "" || t.WorkflowJSON != "" || b.deps.Workflows == nil {
		return nil
	}
	wf, ok := b.deps.Workflows.Get(t.WorkflowID)
	if !ok {
		return invalid("workflow %q is not available", t.WorkflowID)
	}
	js, err := json.Marshal(wf)
	if err != nil {
		return err
	}
	hash := workflowHash(js)
	if err := b.deps.Tasks.SetWorkflowSnapshot(t.ID, string(js), hash); err != nil {
		return err
	}
	t.WorkflowJSON, t.WorkflowHash = string(js), hash
	return nil
}

// snapshotStartedTasks gives a task that started before snapshots existed the live workflow as its
// snapshot: the version it began with is gone, so the current one is the best faithful answer.
func (b *TaskBoard) snapshotStartedTasks() {
	tasks, err := b.deps.Tasks.ListLive()
	if err != nil {
		slog.Warn("ade: snapshot started tasks", "scope", "ade", "err", err)
		return
	}
	for _, t := range tasks {
		if t.WorkflowID == "" || t.WorkflowJSON != "" {
			continue
		}
		runs, err := b.deps.Tasks.RunsOfTask(t.ID)
		if err != nil || len(runs) == 0 {
			continue
		}
		if err := b.snapshotWorkflow(&t); err != nil {
			slog.Warn("ade: snapshot started task", "scope", "ade", "task", t.ID, "err", err)
		}
	}
}

// decorateTask fills the wire fields that depend on the snapshot. liveHash resolves a workflow id to
// the hash of its live file, memoised by the caller.
func decorateTask(out *adewire.Task, t model.AdeTask, liveHash func(id string) (string, bool)) {
	if t.WorkflowJSON == "" {
		return
	}
	var wf adewire.Workflow
	if err := json.Unmarshal([]byte(t.WorkflowJSON), &wf); err != nil {
		return
	}
	out.Workflow = &wf
	if live, ok := liveHash(t.WorkflowID); ok {
		out.WorkflowOutdated = live != t.WorkflowHash
	}
}

// liveHasher returns a memoised id -> live workflow hash lookup.
func (b *TaskBoard) liveHasher() func(id string) (string, bool) {
	type entry struct {
		hash string
		ok   bool
	}
	seen := map[string]entry{}
	return func(id string) (string, bool) {
		if e, hit := seen[id]; hit {
			return e.hash, e.ok
		}
		var e entry
		if b.deps.Workflows != nil {
			if wf, ok := b.deps.Workflows.Get(id); ok {
				if js, err := json.Marshal(wf); err == nil {
					e = entry{workflowHash(js), true}
				}
			}
		}
		seen[id] = e
		return e.hash, e.ok
	}
}
