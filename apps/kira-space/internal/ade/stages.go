package ade

import "github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"

// firstRunnable is the first stage a task enters: the first one not skipped.
func firstRunnable(wf adewire.Workflow) (adewire.Stage, bool) {
	return nextRunnable(wf, -1)
}

// nextRunnable is the first non-skipped stage after index from.
func nextRunnable(wf adewire.Workflow, from int) (adewire.Stage, bool) {
	for i := from + 1; i < len(wf.Stages); i++ {
		if !wf.Stages[i].Skip {
			return wf.Stages[i], true
		}
	}
	return adewire.Stage{}, false
}
