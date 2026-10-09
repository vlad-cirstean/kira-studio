package scriptruns

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/runoutcome"
	"github.com/kirathecat/kira-studio/internal/scripts"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

// Service owns the run lifecycle; it is the terminal.ScriptLauncher.
type Service struct {
	Runs     *Repo
	Scripts  *scripts.Repo
	Registry *terminal.Registry
	// Home is the app data folder; App is "Studio" or "Space", for reasons that name the app.
	Home string
	App  string
	// Emit pushes a changed run to every window.
	Emit func(Run)
	Now  func() time.Time
}

var _ terminal.ScriptLauncher = (*Service)(nil)

func (s *Service) now() int64 {
	if s.Now != nil {
		return s.Now().UnixMilli()
	}
	return time.Now().UnixMilli()
}

func (s *Service) emit(r Run) {
	if s.Emit != nil {
		s.Emit(r)
	}
}

// Begin loads the script, prepares its folder and records a running run. A blocked folder records
// a failed run too, so the attempt shows in the runs list.
func (s *Service) Begin(scriptID, terminalID string) (terminal.ScriptLaunch, error) {
	rec, err := s.Scripts.Get(scriptID)
	if err != nil {
		return terminal.ScriptLaunch{}, ipcerr.InternalErr(err)
	}
	if rec == nil {
		return terminal.ScriptLaunch{}, ipcerr.NotFound("script not found")
	}
	dir := scripts.ResolveDir(*rec, s.Home)
	now := s.now()
	run := Run{
		ID: uuid.NewString(), ScriptID: rec.ID, ScriptName: rec.Name, Color: rec.Color, Kind: "script",
		Trigger: TriggerTerminal, State: StateRunning, TerminalID: terminalID, Cwd: dir.Path, Command: rec.Command,
		CreatedAt: now, StartedAt: &now,
	}
	if err := scripts.PrepareDir(dir); err != nil {
		o := runoutcome.ForProcess(runoutcome.Process{End: runoutcome.EndStartErr, Err: err})
		run.State, run.Outcome, run.FinishedAt = string(o.Status), &o, &now
		s.record(run)
		return terminal.ScriptLaunch{}, ipcerr.New("E_INVALID", err.Error())
	}
	if err := s.Runs.Insert(run); err != nil {
		return terminal.ScriptLaunch{}, ipcerr.InternalErr(err)
	}
	s.emit(run)
	return terminal.ScriptLaunch{RunID: run.ID, Cwd: dir.Path, Command: rec.Command}, nil
}

func (s *Service) record(run Run) {
	if err := s.Runs.Insert(run); err != nil {
		slog.Warn("scriptruns: record run", "scope", "scriptruns", "err", err)
		return
	}
	s.emit(run)
	s.purge()
}

func (s *Service) purge() {
	if err := s.Runs.Purge(); err != nil {
		slog.Warn("scriptruns: purge", "scope", "scriptruns", "err", err)
	}
}

func (s *Service) finish(run *Run, err error) {
	if err != nil {
		slog.Warn("scriptruns: finish run", "scope", "scriptruns", "err", err)
		return
	}
	if run == nil {
		return
	}
	s.emit(*run)
	s.purge()
}

// Failed records that the run's session did not spawn.
func (s *Service) Failed(runID string, err error) {
	o := runoutcome.ForProcess(runoutcome.Process{End: runoutcome.EndStartErr, Err: err})
	run, ferr := s.Runs.FinishByRun(runID, o, s.now())
	s.finish(run, ferr)
}

// Exited records how the run's session ended. A second call for the same session is a no-op.
func (s *Service) Exited(terminalID string, code int, cause terminal.CloseCause) {
	p := runoutcome.Process{Kind: runoutcome.KindScript, ExitCode: code, App: s.App}
	switch cause {
	case terminal.CauseUser:
		p.End = runoutcome.EndUser
	case terminal.CauseWindow:
		p.End = runoutcome.EndWindow
	case terminal.CauseQuit:
		p.End = runoutcome.EndQuit
	}
	run, err := s.Runs.FinishByTerminal(terminalID, runoutcome.ForProcess(p), s.now())
	s.finish(run, err)
}

// List returns the newest runs first.
func (s *Service) List(limit int) ([]Run, error) {
	if limit <= 0 || limit > keepFinished {
		limit = keepFinished
	}
	return s.Runs.List(limit)
}

// Get returns one run.
func (s *Service) Get(id string) (Run, error) { return s.Runs.Get(id) }

// Stop ends a running run's session; the run then finishes as stopped by the user.
func (s *Service) Stop(id string) error {
	run, err := s.Runs.Get(id)
	if err != nil {
		return err
	}
	if run.State != StateRunning {
		return nil
	}
	s.Registry.Close(run.TerminalID)
	return nil
}

// ResolveDir previews where a saved script runs. An empty id answers the app home as Base, for a
// script not saved yet.
func (s *Service) ResolveDir(scriptID string) (scripts.Dir, error) {
	if scriptID == "" {
		return scripts.Dir{Mode: scripts.DirModeKira, Base: s.Home}, nil
	}
	rec, err := s.Scripts.Get(scriptID)
	if err != nil {
		return scripts.Dir{}, err
	}
	if rec == nil {
		return scripts.Dir{}, fmt.Errorf("scriptruns: resolve dir %s: %w", scriptID, sql.ErrNoRows)
	}
	return scripts.ResolveDir(*rec, s.Home), nil
}

// Recover ends every run the previous process left running. Call it before the bound services register.
func (s *Service) Recover() error {
	o := runoutcome.ForProcess(runoutcome.Process{End: runoutcome.EndRestart, App: s.App})
	runs, err := s.Runs.FailRunning(o, s.now())
	if err != nil {
		return err
	}
	for _, r := range runs {
		s.emit(r)
	}
	return s.Runs.Purge()
}

// IsCallerError reports whether err is the caller's fault.
func IsCallerError(err error) bool { return errors.Is(err, sql.ErrNoRows) }
