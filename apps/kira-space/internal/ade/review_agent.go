package ade

import (
	"context"
	"fmt"
	"os"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// reviewStageID is the id of the sample workflows' review stage; ▶ Review there opens the review agent.
const reviewStageID = "review"

// launchReviewAgent is the one launcher of a task's review agent: a new conversation, or the stopped
// one resumed with fresh --add-dir directories. message is the user's first message ("" = none on a
// resume, the composed review message on a new launch). stage, when set, adds its prompt to the
// composed message. The task mutex is held.
func (b *TaskBoard) launchReviewAgent(ctx context.Context, tc *taskCtx, tr *Tracker, message string, stage *adewire.Stage) (adewire.Launch, bool, string, error) {
	row, err := b.deps.Sessions.ReviewAgent(tc.task.ID)
	if err != nil {
		return adewire.Launch{}, false, "", err
	}
	if row != nil && row.State == model.AdeSessionStateRunning {
		return adewire.Launch{}, false, "", invalid("a review agent is already running")
	}
	lines, cwd, extra, err := b.launchDirs(ctx, tc)
	if err != nil {
		return adewire.Launch{}, false, "", err
	}
	var addDirs []string
	if len(extra) > 0 {
		addDirs = append([]string{"--add-dir"}, extra...)
	}
	note := ""
	if row != nil {
		if info, serr := os.Stat(row.Cwd); serr == nil && info.IsDir() {
			res, err := tr.Prepare(PrepareArgs{TaskID: tc.task.ID, Resume: row.ID, Message: message, ExtraArgs: addDirs})
			if err != nil {
				return adewire.Launch{}, false, "", err
			}
			return launchOf(res), true, "", nil
		}
		if err := b.deps.Sessions.ClearPurpose(row.ID); err != nil {
			return adewire.Launch{}, false, "", err
		}
		note = fmt.Sprintf("The previous review conversation ran in %s, which no longer exists. Started a new one.", row.Cwd)
	}
	if message == "" {
		title := taskTitle(tc.task, tc.branches)
		message = composeReviewMessage(title, tc.task.JiraKey, tc.task.JiraURL, tc.task.Notes, lines)
		if stage != nil && stage.Prompt != "" {
			message += "\n" + substitute(stage.Prompt, repoVars(title, tc.task.JiraKey, lines), false)
		}
	}
	res, err := tr.Prepare(PrepareArgs{
		TaskID: tc.task.ID, Cwd: cwd, Message: message, ExtraArgs: addDirs, Purpose: model.AdeSessionPurposeReview,
	})
	if err != nil {
		return adewire.Launch{}, false, "", err
	}
	return launchOf(res), false, note, nil
}

// LaunchReviewAgent starts or resumes the task's review agent (the review window's button).
func (b *TaskBoard) LaunchReviewAgent(ctx context.Context, taskID string) (adewire.ReviewAgentLaunch, error) {
	tr, err := b.tracker()
	if err != nil {
		return adewire.ReviewAgentLaunch{}, err
	}
	mu := b.taskMu(taskID)
	mu.Lock()
	defer mu.Unlock()
	tc, err := b.loadTaskCtx(taskID)
	if err != nil {
		return adewire.ReviewAgentLaunch{}, err
	}
	l, resumed, note, err := b.launchReviewAgent(ctx, tc, tr, "", nil)
	if err != nil {
		return adewire.ReviewAgentLaunch{}, err
	}
	return adewire.ReviewAgentLaunch{Launch: l, Resumed: resumed, Note: note}, nil
}

// ReviewAgent returns the task's review agent row as a wire session, nil when it has none.
func (b *TaskBoard) ReviewAgent(taskID string) (*adewire.Session, error) {
	row, err := b.deps.Sessions.ReviewAgent(taskID)
	if err != nil || row == nil {
		return nil, err
	}
	w := toWireSession(*row)
	return &w, nil
}
