package ade

import (
	"context"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
)

// SetTaskWorkflow switches the task's workflow and restarts it at the first stage: the task's runs
// and run logs go. The same id is a no-op; "" clears workflow and stage.
func (b *TaskBoard) SetTaskWorkflow(_ context.Context, args adewire.SetTaskWorkflowArgs) (adewire.Task, error) {
	mu := b.taskMu(args.TaskID)
	mu.Lock()
	defer mu.Unlock()
	task, err := b.deps.Tasks.GetTask(args.TaskID)
	if err != nil {
		return adewire.Task{}, err
	}
	if task.WorkflowID == args.WorkflowID {
		return b.wireTask(task)
	}
	var stageID, stageJSON string
	if args.WorkflowID != "" {
		if b.deps.Workflows == nil {
			return adewire.Task{}, invalid("workflow %q not found", args.WorkflowID)
		}
		wf, ok := b.deps.Workflows.Get(args.WorkflowID)
		if !ok {
			return adewire.Task{}, invalid("workflow %q not found", args.WorkflowID)
		}
		if stageID, stageJSON, err = stageSnapshot(wf); err != nil {
			return adewire.Task{}, err
		}
	}
	running, err := b.deps.Tasks.HasRunning(args.TaskID)
	if err != nil {
		return adewire.Task{}, err
	}
	if running {
		return adewire.Task{}, invalid("stop its running agents first")
	}
	if err := b.deps.Tasks.ResetWorkflow(args.TaskID, args.WorkflowID, stageID, stageJSON); err != nil {
		return adewire.Task{}, err
	}
	b.clearStepMessages(args.TaskID)
	b.notifyBoard()
	task, err = b.deps.Tasks.GetTask(args.TaskID)
	if err != nil {
		return adewire.Task{}, err
	}
	return b.wireTask(task)
}

func (b *TaskBoard) clearStepMessages(taskID string) {
	prefix := taskID + "|"
	b.runMu.Lock()
	defer b.runMu.Unlock()
	for k := range b.stepMsgs {
		if strings.HasPrefix(k, prefix) {
			delete(b.stepMsgs, k)
		}
	}
}
