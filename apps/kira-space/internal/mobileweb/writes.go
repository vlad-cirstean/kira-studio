package mobileweb

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// Permission failure codes on the wire; the phone names the desktop pane that fixes each.
const (
	codeWriteOff      = "E_WRITE_OFF"
	codeAgentInputOff = "E_AGENT_INPUT_OFF"
	codeUnavailable   = "E_UNAVAILABLE"
	maxWriteBody      = 64 << 10
	// writeCallLimit bounds one service call. A write detaches from the phone's connection so a
	// dropped request cannot abort it half way; the idempotency key lets the phone retry.
	writeCallLimit = 80 * time.Second
)

type permissionsBody struct {
	Write      bool `json:"write"`
	AgentInput bool `json:"agentInput"`
}

type meBody struct {
	DeviceID    string          `json:"deviceId"`
	Label       string          `json:"label"`
	Permissions permissionsBody `json:"permissions"`
	// AgentInputGlobal is the desktop's global switch, so the phone can say which switch is off.
	AgentInputGlobal bool `json:"agentInputGlobal"`
}

func (s *Server) agentInputGlobal() bool {
	return s.cfg.AgentInputEnabled != nil && s.cfg.AgentInputEnabled()
}

func (s *Server) handleMe(w http.ResponseWriter, _ *http.Request, d repos.MobileDeviceRow) {
	global := s.agentInputGlobal()
	writeJSON(w, http.StatusOK, meBody{
		DeviceID: d.ID, Label: d.Label, AgentInputGlobal: global,
		Permissions: permissionsBody{Write: d.CanWrite, AgentInput: d.CanAgentInput && global},
	})
}

// requirePerm refuses a device that lacks the row's permission. Agent input needs the device flag
// and the global switch: both are set on the desktop.
func (s *Server) requirePerm(rt route, next deviceHandler) deviceHandler {
	return func(w http.ResponseWriter, r *http.Request, dev repos.MobileDeviceRow) {
		switch rt.perm {
		case permWrite:
			if !dev.CanWrite {
				writeError(w, http.StatusForbidden, codeWriteOff,
					"Changes are off for this phone. Turn on Changes for it in Settings > Mobile access on the computer.")
				return
			}
		case permAgentInput:
			if !s.agentInputGlobal() {
				writeJSON(w, http.StatusForbidden, errorBody{Code: codeAgentInputOff, Reason: "global",
					Message: "Agent input is off. Turn it on in Settings > Mobile access on the computer."})
				return
			}
			if !dev.CanAgentInput {
				writeJSON(w, http.StatusForbidden, errorBody{Code: codeAgentInputOff, Reason: "device",
					Message: "Agent input is off for this phone. Turn it on for this phone in Settings > Mobile access on the computer."})
				return
			}
		}
		next(w, r, dev)
	}
}

// writeLimit rate limits a write per device; an attach has its own, slower bucket.
func (s *Server) writeLimit(rt route, next deviceHandler) deviceHandler {
	return func(w http.ResponseWriter, r *http.Request, dev repos.MobileDeviceRow) {
		limiter := s.writeRate
		if rt.kind == kindUpgrade {
			limiter = s.attachRate
		}
		if !limiter.allow(dev.ID) {
			writeRateLimited(w)
			return
		}
		next(w, r, dev)
	}
}

type auditKey struct{}

// auditFields collects the ids a handler names for its audit line. Message text and keystrokes
// are never added.
type auditFields struct {
	mu sync.Mutex
	kv []any
}

func auditAdd(r *http.Request, kv ...any) {
	if f, ok := r.Context().Value(auditKey{}).(*auditFields); ok {
		f.mu.Lock()
		f.kv = append(f.kv, kv...)
		f.mu.Unlock()
	}
}

// logWrite is the one audit line of a phone write, attach, release or reclaim.
func logWrite(device, action string, kv ...any) {
	slog.Info("mobileweb: write", append([]any{"scope", "mobileweb", "device", device, "action", action}, kv...)...)
}

func (s *Server) audited(rt route, next deviceHandler) deviceHandler {
	return func(w http.ResponseWriter, r *http.Request, dev repos.MobileDeviceRow) {
		f := &auditFields{}
		rec := newRecorder(w, false)
		r = r.WithContext(context.WithValue(r.Context(), auditKey{}, f))
		next(rec, r, dev)
		f.mu.Lock()
		defer f.mu.Unlock()
		logWrite(dev.ID, rt.action, append(f.kv, "status", rec.status)...)
	}
}

// decodeBody reads one strict JSON object; false means the 400 is written.
func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxWriteBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "E_BAD_REQUEST", "invalid request body")
		return false
	}
	return true
}

// call runs one Writer method for a decoded request on a context detached from the phone's
// connection.
func writeRoute[Req, Res any](s *Server, call func(ctx context.Context, wr Writer, r *http.Request, req Req) (Res, error)) deviceHandler {
	return func(w http.ResponseWriter, r *http.Request, _ repos.MobileDeviceRow) {
		if s.cfg.Writer == nil {
			writeError(w, http.StatusServiceUnavailable, codeUnavailable, "changes are unavailable")
			return
		}
		var req Req
		if !decodeBody(w, r, &req) {
			return
		}
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), writeCallLimit)
		defer cancel()
		res, err := call(ctx, s.cfg.Writer, r, req)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	}
}

type empty struct{}

// taskStageRequest is what a phone sends to act on a task: the stage it saw, so the engine can
// refuse when the task has moved on. An empty value would skip the guard, so it is required.
type taskStageRequest struct {
	TaskID      string `json:"taskId"`
	FromStageID string `json:"fromStageId"`
}

var errFromStage = errors.New("fromStageId is required")

func (q taskStageRequest) validate() error {
	if q.FromStageID == "" {
		return errFromStage
	}
	return nil
}

type taskStageResult struct {
	TaskID  string `json:"taskId"`
	StageID string `json:"stageId"`
}

type runResult struct {
	RunIDs []string `json:"runIds"`
}

type sendRequest struct {
	Message string `json:"message"`
}

type takeOverRequest struct{}

func badRequest(err error) error { return ipcerr.BadRequest(err.Error()) }

func (s *Server) handleBacklogAdd(w http.ResponseWriter, r *http.Request, d repos.MobileDeviceRow) {
	writeRoute(s, func(ctx context.Context, wr Writer, r *http.Request, req adewire.AddBacklogItemArgs) (adewire.BacklogItem, error) {
		it, err := wr.AddBacklogItem(ctx, req)
		if err == nil {
			auditAdd(r, "item", it.ID)
		}
		return it, err
	})(w, r, d)
}

func (s *Server) handleBacklogMove(w http.ResponseWriter, r *http.Request, d repos.MobileDeviceRow) {
	writeRoute(s, func(ctx context.Context, wr Writer, r *http.Request, req adewire.MoveBacklogItemArgs) (empty, error) {
		auditAdd(r, "item", req.ID, "toIndex", req.ToIndex)
		return empty{}, wr.MoveBacklogItem(ctx, req)
	})(w, r, d)
}

func (s *Server) handleTaskStage(w http.ResponseWriter, r *http.Request, d repos.MobileDeviceRow) {
	writeRoute(s, func(ctx context.Context, wr Writer, r *http.Request, req adewire.SetTaskStageArgs) (taskStageResult, error) {
		if req.FromStageID == "" {
			return taskStageResult{}, badRequest(errFromStage)
		}
		auditAdd(r, "task", req.TaskID, "from", req.FromStageID, "to", req.StageID)
		t, err := wr.SetTaskStage(ctx, req)
		return taskStageResult{TaskID: t.ID, StageID: t.StageID}, err
	})(w, r, d)
}

func (s *Server) handleTaskRun(w http.ResponseWriter, r *http.Request, d repos.MobileDeviceRow) {
	writeRoute(s, func(ctx context.Context, wr Writer, r *http.Request, req taskStageRequest) (runResult, error) {
		if err := req.validate(); err != nil {
			return runResult{}, badRequest(err)
		}
		auditAdd(r, "task", req.TaskID, "stage", req.FromStageID)
		res, err := wr.StartRun(ctx, adewire.StartRunArgs{
			TaskID: req.TaskID, FromStageID: req.FromStageID, BranchNames: map[string]string{},
		})
		return runResult{RunIDs: res.RunIDs}, err
	})(w, r, d)
}

func (s *Server) handleTaskLaunch(w http.ResponseWriter, r *http.Request, d repos.MobileDeviceRow) {
	writeRoute(s, func(ctx context.Context, wr Writer, r *http.Request, req taskStageRequest) (LaunchResult, error) {
		if err := req.validate(); err != nil {
			return LaunchResult{}, badRequest(err)
		}
		auditAdd(r, "task", req.TaskID, "stage", req.FromStageID)
		return wr.LaunchStage(ctx, adewire.LaunchStageArgs{TaskID: req.TaskID, FromStageID: req.FromStageID})
	})(w, r, d)
}

func (s *Server) handleSessionSend(w http.ResponseWriter, r *http.Request, d repos.MobileDeviceRow) {
	writeRoute(s, func(ctx context.Context, wr Writer, r *http.Request, req sendRequest) (empty, error) {
		id := r.PathValue("id")
		auditAdd(r, "session", id)
		return empty{}, wr.Send(ctx, adewire.SendArgs{SessionID: id, Message: req.Message})
	})(w, r, d)
}

func (s *Server) handleSessionTakeOver(w http.ResponseWriter, r *http.Request, d repos.MobileDeviceRow) {
	writeRoute(s, func(ctx context.Context, wr Writer, r *http.Request, _ takeOverRequest) (LaunchResult, error) {
		id := r.PathValue("id")
		auditAdd(r, "session", id)
		return wr.TakeOver(ctx, adewire.TakeOverArgs{SessionID: id, StopIfRunning: true})
	})(w, r, d)
}

func (s *Server) handleTerminal(w http.ResponseWriter, r *http.Request, d repos.MobileDeviceRow) {
	if s.cfg.Terminals == nil {
		writeError(w, http.StatusServiceUnavailable, codeUnavailable, "terminals are unavailable")
		return
	}
	id := r.PathValue("id")
	logWrite(d.ID, "terminal.attach", "session", id)
	s.cfg.Terminals.Serve(w, r, d, id)
}
