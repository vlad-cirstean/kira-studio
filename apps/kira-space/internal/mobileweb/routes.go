package mobileweb

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

type access int

const (
	accessPublic access = iota // reachable before pairing
	accessDevice               // requires a paired, unrevoked device
)

type route struct {
	method string
	path   string
	access access
	handle func(http.ResponseWriter, *http.Request, repos.MobileDeviceRow)
}

const (
	apiDeadline = 30 * time.Second
	flightLimit = 25 * time.Second
)

// routes is the complete app-port API. The mux registers exactly these, and a test walks them: a
// new endpoint is a deliberate row here. Every state-changing method also passes csrfGuard, and a
// device route is already per-device authenticated and rate limited, so a later write endpoint
// is one row, not new plumbing.
func (s *Server) routes() []route {
	return []route{
		{http.MethodPost, "/api/pair", accessPublic, func(w http.ResponseWriter, r *http.Request, _ repos.MobileDeviceRow) { s.handlePair(w, r) }},
		{http.MethodGet, "/api/me", accessDevice, func(w http.ResponseWriter, _ *http.Request, d repos.MobileDeviceRow) {
			writeJSON(w, http.StatusOK, deviceBody{DeviceID: d.ID, Label: d.Label})
		}},
		{http.MethodGet, "/api/events", accessDevice, func(w http.ResponseWriter, r *http.Request, d repos.MobileDeviceRow) { s.handleEvents(w, r, d.ID) }},
		{http.MethodGet, "/api/ade/board", accessDevice, readJSON(s, "board", true, s.cfg.Reader.Board)},
		{http.MethodGet, "/api/ade/prs", accessDevice, readJSON(s, "prs", true, s.cfg.Reader.Prs)},
		{http.MethodGet, "/api/ade/sessions", accessDevice, readJSON(s, "sessions", false, s.cfg.Reader.Sessions)},
		{http.MethodGet, "/api/ade/workflows", accessDevice, readJSON(s, "workflows", false, s.cfg.Reader.Workflows)},
		{http.MethodGet, "/api/ade/backlog", accessDevice, readJSON(s, "backlog", false, s.cfg.Reader.Backlog)},
		{http.MethodGet, "/api/ade/repos", accessDevice, readJSON(s, "repos", false, s.repoNames)},
		{http.MethodGet, "/api/ade/log", accessDevice, s.handleLog},
		{http.MethodGet, "/api/agent/sessions", accessDevice, func(w http.ResponseWriter, _ *http.Request, _ repos.MobileDeviceRow) {
			writeJSON(w, http.StatusOK, s.cfg.AgentSessions())
		}},
	}
}

// appMux registers the route table plus the static shell. Everything under /api not in the table
// is a 404/405 from the mux or the static handler, never a handler.
func (s *Server) appMux() *http.ServeMux {
	mux := http.NewServeMux()
	for _, rt := range s.routes() {
		var h http.Handler
		if rt.access == accessDevice {
			h = s.withDevice(rt.handle)
		} else {
			h = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { rt.handle(w, r, repos.MobileDeviceRow{}) })
		}
		h = noStore(csrfGuard(deadline(rt.path, h)))
		mux.Handle(rt.method+" "+rt.path, h)
	}
	mux.Handle("GET /", s.staticHandler())
	return mux
}

func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// deadline bounds slow clients per route: the server has no global WriteTimeout because the SSE
// stream and the pairing long-poll outlive any single value. Those two set their own.
func deadline(path string, next http.Handler) http.Handler {
	if path == "/api/events" || path == "/api/pair" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(apiDeadline))
		next.ServeHTTP(w, r)
	})
}

// readJSON serves one Reader call. Board and Prs each do git work per repo, so concurrent
// requests share one in-flight call (detached from the first caller's cancellation).
func readJSON[T any](s *Server, key string, coalesce bool, fetch func(context.Context) (T, error)) func(http.ResponseWriter, *http.Request, repos.MobileDeviceRow) {
	return func(w http.ResponseWriter, r *http.Request, _ repos.MobileDeviceRow) {
		var (
			v   T
			err error
		)
		if coalesce {
			res, ferr, _ := s.flight.Do(key, func() (any, error) {
				ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), flightLimit)
				defer cancel()
				return fetch(ctx)
			})
			err = ferr
			if err == nil {
				v = res.(T)
			}
		} else {
			v, err = fetch(r.Context())
		}
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, v)
	}
}

type repoName struct {
	CodeRepoID string `json:"codeRepoId"`
	Name       string `json:"name"`
	Nickname   string `json:"nickname"`
}

type repoNamesResult struct {
	Repos []repoName `json:"repos"`
}

// repoNames projects the repo list to display names: the phone never sees paths or scripts.
func (s *Server) repoNames(ctx context.Context) (repoNamesResult, error) {
	res, err := s.cfg.Reader.Repos(ctx)
	if err != nil {
		return repoNamesResult{}, err
	}
	out := repoNamesResult{Repos: make([]repoName, 0, len(res.Repos))}
	for _, r := range res.Repos {
		out.Repos = append(out.Repos, repoName{CodeRepoID: r.CodeRepoID, Name: r.Name, Nickname: r.Nickname})
	}
	return out, nil
}

func (s *Server) handleLog(w http.ResponseWriter, r *http.Request, _ repos.MobileDeviceRow) {
	q := r.URL.Query()
	args := adewire.ReadLogArgs{Kind: q.Get("kind"), ID: q.Get("id")}
	if raw := q.Get("afterSeq"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "E_BAD_REQUEST", "afterSeq must be a number")
			return
		}
		args.AfterSeq = n
	}
	page, err := s.cfg.Reader.ReadLog(r.Context(), args)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}
