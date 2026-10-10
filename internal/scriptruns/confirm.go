package scriptruns

import (
	"database/sql"
	"errors"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/runoutcome"
)

// errAnswered is what a second answer to a run gets.
func errAnswered() error { return ipcerr.New("E_INVALID", "this run was already answered") }

// ConfirmAccept starts a waiting scheduled run the user accepted. hash is the preview the user saw.
func (s *Service) ConfirmAccept(runID, hash string, secrets map[string][]string) (Started, error) {
	run, err := s.Runs.Get(runID)
	if errors.Is(err, sql.ErrNoRows) {
		return Started{}, ipcerr.NotFound("run not found")
	}
	if err != nil {
		return Started{}, ipcerr.InternalErr(err)
	}
	if run.State != StateWaiting {
		return Started{}, errAnswered()
	}
	rec, err := s.Scripts.Get(run.ScriptID)
	if err != nil {
		return Started{}, ipcerr.InternalErr(err)
	}
	if rec == nil || rec.Schedule == nil {
		reason := "the script was removed"
		if rec != nil {
			reason = "the schedule was turned off"
		}
		s.skipWaiting(skipByID, runID, reason, runoutcome.SourceSchedule)
		return Started{}, ipcerr.New("E_INVALID", reason)
	}
	if active, err := s.Runs.Active(rec.ID, run.ID); err != nil {
		return Started{}, ipcerr.InternalErr(err)
	} else if active != nil {
		return Started{}, ipcerr.New("E_INVALID", overlapText(*rec, *active))
	}
	p, err := s.plan(scheduleArgs(*rec, secrets), planOpts{headless: true})
	if err != nil {
		return Started{}, err
	}
	if err := checkStart(p, hash); err != nil {
		return Started{}, err
	}
	return s.startScheduled(p, &run)
}

// ConfirmDecline ends a waiting run as declined; a run already answered is left alone.
func (s *Service) ConfirmDecline(runID string) {
	s.skipWaiting(skipByID, runID, "you declined it", runoutcome.SourceUser)
}

// RunScheduleNow starts a script's scheduled run at once, after the confirm popup.
func (s *Service) RunScheduleNow(scriptID, hash string, secrets map[string][]string) (Started, error) {
	rec, err := s.scheduled(scriptID)
	if err != nil {
		return Started{}, err
	}
	if active, err := s.Runs.Active(rec.ID, ""); err != nil {
		return Started{}, ipcerr.InternalErr(err)
	} else if active != nil {
		return Started{}, ipcerr.New("E_INVALID", overlapText(*rec, *active))
	}
	p, err := s.plan(scheduleArgs(*rec, secrets), planOpts{headless: true})
	if err != nil {
		return Started{}, err
	}
	if err := checkStart(p, hash); err != nil {
		return Started{}, err
	}
	return s.startScheduled(p, nil)
}

// MainWindowKey is the window the confirm popup shows in, "" when none is open.
func (s *Service) MainWindowKey() string {
	if s.MainWindow == nil {
		return ""
	}
	return s.MainWindow()
}
