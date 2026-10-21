package ade

import (
	"context"
	"os"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
)

// reviewStepID is the id of the manual review step; ▶ Review there opens the review agent.
const reviewStepID = "review"

// launchReviewAgent is the one launcher of a task's review agent: a new conversation, or the
// stopped one resumed with fresh --add-dir directories. message is the user's first message ("" =
// none on a resume, the composed review message on a new launch). step, when set, adds its prompt
// to the composed message. The task mutex is held.
func (b *TaskBoard) launchReviewAgent(ctx context.Context, tc *taskCtx, tr *Tracker, message string, step *adewire.WorkflowStep) (adewire.Launch, bool, string, error) {
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
	note := ""
	if row != nil {
		if info, serr := os.Stat(row.Cwd); serr == nil && info.IsDir() {
			res, err := tr.Prepare(PrepareArgs{TaskID: tc.task.ID, Resume: row.ID, Message: message, AddDirs: extra})
			if err != nil {
				return adewire.Launch{}, false, "", err
			}
			return launchOf(res), true, "", nil
		}
		if err := b.deps.Sessions.ClearPurpose(row.ID); err != nil {
			return adewire.Launch{}, false, "", err
		}
		note = i18n.T("backend.space.ade.reviewConversationReset.body", map[string]string{"path": row.Cwd})
	}
	if message == "" {
		title := taskTitle(tc.task, tc.branches)
		message = composeReviewMessage(b.prompts(), title, tc.task.JiraKey, tc.task.JiraURL, tc.task.Notes, lines)
		if step != nil && step.Prompt != "" {
			message += "\n" + substitute(step.Prompt, repoVars(title, tc.task.JiraKey, lines), false)
		}
	}
	res, err := tr.Prepare(PrepareArgs{
		TaskID: tc.task.ID, Cwd: cwd, Message: message, AddDirs: extra, Purpose: model.AdeSessionPurposeReview,
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
