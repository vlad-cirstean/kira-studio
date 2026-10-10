package scriptruns

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/loginshell"
	"github.com/kirathecat/kira-studio/internal/runoutcome"
	"github.com/kirathecat/kira-studio/internal/scripts"
)

// How a background (smart or headless) run was ended from outside, set before its context is cancelled.
const (
	endNone = iota
	endUser
	endQuit
)

type bgRun struct {
	cancel context.CancelFunc
	mu     sync.Mutex
	end    int
}

func (r *bgRun) stop(end int) {
	r.mu.Lock()
	if r.end == endNone {
		r.end = end
	}
	r.mu.Unlock()
	r.cancel()
}

func (r *bgRun) endedBy() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.end
}

// mcpServer returns the loopback report server, started on first use.
func (s *Service) mcpServer() *claudeheadless.Server {
	if s.server == nil {
		opts := claudeheadless.Options{Dir: filepath.Join(s.Home, "automations-mcp"), OnFinish: s.recordFinish}
		if s.ADE != nil {
			opts.Space, opts.Outcomes = s.ADE.Tools()
		}
		s.server = claudeheadless.NewServer(opts)
	}
	return s.server
}

func (s *Service) recordFinish(runID string, f claudeheadless.Finish) {
	s.mu.Lock()
	if s.finishes == nil {
		s.finishes = map[string]claudeheadless.Finish{}
	}
	s.finishes[runID] = f
	s.mu.Unlock()
}

func (s *Service) takeFinish(runID string) (claudeheadless.Finish, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.finishes[runID]
	delete(s.finishes, runID)
	return f, ok
}

func (s *Service) startSmart(p *planned) (Started, error) {
	return s.launchSmart(p, s.newRun(p, nil), false)
}

// launchSmart runs a smart script headless. existing means run is a waiting row to turn running.
func (s *Service) launchSmart(p *planned, run Run, existing bool) (Started, error) {
	runID, sessionID := run.ID, run.SessionID
	ctx, cancel := context.WithCancel(context.Background())
	sr := &bgRun{cancel: cancel}

	s.mu.Lock()
	switch {
	case s.closed:
		s.mu.Unlock()
		cancel()
		return Started{}, ipcerr.New("E_INVALID", "Kira "+s.App+" is closing")
	case len(s.smart) >= maxSmartRuns:
		s.mu.Unlock()
		cancel()
		return Started{}, ipcerr.New("E_INVALID", fmt.Sprintf("%d smart scripts are running: wait for one to finish", maxSmartRuns))
	}
	if s.smart == nil {
		s.smart = map[string]*bgRun{}
	}
	s.smart[runID] = sr
	s.smartWait.Add(1)
	s.mu.Unlock()
	abandon := func() {
		cancel()
		s.mu.Lock()
		delete(s.smart, runID)
		s.mu.Unlock()
		s.smartWait.Done()
	}

	pv := p.preview
	if err := scripts.PrepareDir(p.dir); err != nil {
		abandon()
		if !existing {
			now := s.now()
			o := runoutcome.ForProcess(runoutcome.Process{End: runoutcome.EndStartErr, Err: err})
			run.State, run.Outcome, run.FinishedAt = string(o.Status), &o, &now
			s.record(run)
		}
		return Started{}, ipcerr.New("E_INVALID", err.Error())
	}
	s.mu.Lock()
	srv := s.mcpServer()
	s.mu.Unlock()
	cfg, releaseGrant, err := srv.Register(claudeheadless.Grant{RunID: runID, TaskID: run.TaskID, Space: run.TaskID != ""})
	if err != nil {
		abandon()
		return Started{}, ipcerr.InternalErr(err)
	}
	var extra []string
	releaseUser := func() {}
	if len(p.mcp) > 0 {
		path, rel, err := claudeheadless.WriteUserConfig(s.getenv, filepath.Join(s.Home, "automations-mcp"), runID, p.mcp)
		if err != nil {
			releaseGrant()
			abandon()
			return Started{}, ipcerr.New("E_INVALID", err.Error())
		}
		extra, releaseUser = []string{path}, rel
	}
	if err := s.begin(run, existing); err != nil {
		releaseGrant()
		releaseUser()
		abandon()
		return Started{}, err
	}

	timeout := p.smart.TimeoutDuration()
	timeoutText := p.smart.Timeout
	if s.SmartTimeout > 0 {
		timeout, timeoutText = s.SmartTimeout, s.SmartTimeout.String()
	}
	env := claudeheadless.ScrubSessionEnv(loginshell.ScrubGitEnv(os.Environ()))
	env = append(env, "GIT_TERMINAL_PROMPT=0")
	env = append(env, p.envList...)
	spec := claudeheadless.Spec{
		Dir: p.dir.Path, Prompt: p.sent, SessionID: sessionID, MCPConfigPath: cfg, MCPConfigPaths: extra,
		Model: p.smart.Model, MaxBudgetUSD: p.smart.MaxBudgetUSD, Tools: pv.Tools, AllowedTools: pv.Allowed,
		Isolated: true, Timeout: timeout, Env: env,
	}
	go func() {
		defer s.smartWait.Done()
		sink := newLogSink(s, runID)
		var res *claudeheadless.Result
		exit, runErr := claudeheadless.Run(ctx, spec, claudeheadless.Handler{
			OnLine:   func(l claudeheadless.Line) { sink.add(l.Stream, l.Text) },
			OnResult: func(r claudeheadless.Result) { res = &r },
		})
		sink.flush()
		releaseGrant()
		releaseUser()
		out := decide(decision{
			finish: s.takeFinishPtr(runID), res: res, exit: exit, runErr: runErr, end: sr.endedBy(),
			timeout: timeoutText, budget: p.smart.MaxBudgetUSD, app: s.App, lastErr: sink.lastStderr(),
		})
		cancel()
		done, ferr := s.Runs.FinishByRun(runID, out, s.now())
		if p.release != nil {
			p.release()
		}
		s.mu.Lock()
		delete(s.smart, runID)
		delete(s.finishes, runID)
		s.mu.Unlock()
		s.finish(done, ferr)
	}()
	return Started{RunID: runID}, nil
}

func (s *Service) takeFinishPtr(runID string) *claudeheadless.Finish {
	if f, ok := s.takeFinish(runID); ok {
		return &f
	}
	return nil
}

func (s *Service) stopSmart(id string) {
	s.mu.Lock()
	sr := s.smart[id]
	s.mu.Unlock()
	if sr != nil {
		sr.stop(endUser)
	}
}

func (s *Service) stopHeadless(id string) {
	s.mu.Lock()
	br := s.bg[id]
	s.mu.Unlock()
	if br != nil {
		br.stop(endUser)
	}
}

// Close ends every smart and headless run as interrupted by the quit and waits until each is recorded.
func (s *Service) Close() {
	s.mu.Lock()
	s.closed = true
	runs := make([]*bgRun, 0, len(s.smart)+len(s.bg))
	for _, r := range s.smart {
		runs = append(runs, r)
	}
	for _, r := range s.bg {
		runs = append(runs, r)
	}
	srv := s.server
	s.mu.Unlock()
	for _, r := range runs {
		r.stop(endQuit)
	}
	s.smartWait.Wait()
	s.bgWait.Wait()
	if srv != nil {
		if err := srv.Close(); err != nil {
			slog.Warn("scriptruns: close report server", "scope", "scriptruns", "err", err)
		}
	}
}

type decision struct {
	finish  *claudeheadless.Finish
	res     *claudeheadless.Result
	exit    claudeheadless.Exit
	runErr  error
	end     int
	timeout string
	budget  float64
	app     string
	lastErr string
}

// decide maps how a smart run ended to its outcome: the first matching row wins.
func decide(d decision) runoutcome.Outcome {
	code := d.exit.Code
	var out runoutcome.Outcome
	switch {
	case d.end == endUser:
		out = runoutcome.ForProcess(runoutcome.Process{End: runoutcome.EndUser})
	case d.end == endQuit:
		out = runoutcome.ForProcess(runoutcome.Process{End: runoutcome.EndQuit, App: d.app})
	case d.finish != nil:
		out = runoutcome.Outcome{Source: runoutcome.SourceAgent, Reported: true, Summary: d.finish.Summary, ExitCode: &code}
		switch d.finish.Status {
		case "done":
			out.Status = runoutcome.StatusDone
		case "needs_input":
			out.Status, out.Reason = runoutcome.StatusBlocked, firstNonEmpty(d.finish.Reason, d.finish.Summary)
		default:
			out.Status = runoutcome.StatusFailed
			out.Reason = firstNonEmpty(d.finish.Reason, d.finish.Summary, "the agent reported failure without a reason")
		}
	case resultEnds(d):
		out, _ = claudeheadless.ResultOutcome(d.res, code, d.budget)
	default:
		p := runoutcome.Process{Kind: runoutcome.KindAgent, ExitCode: code, Timeout: d.timeout}
		switch {
		case d.runErr != nil:
			p.End, p.Err = runoutcome.EndStartErr, d.runErr
		case d.exit.TimedOut:
			p.End = runoutcome.EndTimeout
		}
		out = runoutcome.ForProcess(p)
	}
	out = claudeheadless.ApplyResult(out, d.res)
	return out.WithLastError(d.lastErr)
}

func resultEnds(d decision) bool {
	_, ok := claudeheadless.ResultOutcome(d.res, d.exit.Code, d.budget)
	return ok
}

func firstNonEmpty(vals ...string) string { return claudeheadless.FirstNonEmpty(vals...) }
