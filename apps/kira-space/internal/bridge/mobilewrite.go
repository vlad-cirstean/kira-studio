package bridge

import (
	"context"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/mobileweb"
)

// MobileWriter is the phone's write path: each method forwards to the AdeTaskService method the
// desktop calls, so validation, engine rules and error mapping are the same. It is not registered
// with Wails, so nothing here is bound to a renderer.
type MobileWriter struct {
	Svc      *AdeTaskService
	Launches *MobileLaunches
}

var _ mobileweb.Writer = (*MobileWriter)(nil)

func (w *MobileWriter) AddBacklogItem(ctx context.Context, args adewire.AddBacklogItemArgs) (adewire.BacklogItem, error) {
	return w.Svc.AddBacklogItem(ctx, args)
}

func (w *MobileWriter) MoveBacklogItem(ctx context.Context, args adewire.MoveBacklogItemArgs) error {
	return w.Svc.MoveBacklogItem(ctx, args)
}

func (w *MobileWriter) SetTaskStage(ctx context.Context, args adewire.SetTaskStageArgs) (adewire.Task, error) {
	return w.Svc.SetTaskStage(ctx, args)
}

func (w *MobileWriter) StartRun(ctx context.Context, args adewire.StartRunArgs) (adewire.StartRunResult, error) {
	return w.Svc.StartRun(ctx, args)
}

func (w *MobileWriter) Send(ctx context.Context, args adewire.SendArgs) error {
	return w.Svc.Send(ctx, args)
}

// LaunchStage opens the task's interactive stage session, then waits for a desktop window to open
// its terminal.
func (w *MobileWriter) LaunchStage(ctx context.Context, args adewire.LaunchStageArgs) (mobileweb.LaunchResult, error) {
	l, err := w.Svc.LaunchStage(ctx, args)
	if err != nil {
		return mobileweb.LaunchResult{}, err
	}
	return w.open(ctx, l, args.TaskID, "")
}

// TakeOver continues a session in an interactive terminal, opened in a desktop window.
func (w *MobileWriter) TakeOver(ctx context.Context, args adewire.TakeOverArgs) (mobileweb.LaunchResult, error) {
	l, err := w.Svc.TakeOver(ctx, args)
	if err != nil {
		return mobileweb.LaunchResult{}, err
	}
	// The window shows the new session under the old one's task; a failed lookup only loses that
	// selection.
	var taskID, branchID string
	if res, err := w.Svc.Sessions(ctx); err == nil {
		for _, s := range res.Sessions {
			if s.ID == args.SessionID {
				taskID, branchID = s.TaskID, s.BranchID
				break
			}
		}
	}
	return w.open(ctx, l, taskID, branchID)
}

func (w *MobileWriter) open(ctx context.Context, l adewire.Launch, taskID, branchID string) (mobileweb.LaunchResult, error) {
	if err := w.Launches.Open(ctx, l, taskID, branchID); err != nil {
		return mobileweb.LaunchResult{}, err
	}
	return mobileweb.LaunchResult{SessionID: l.SessionID}, nil
}
