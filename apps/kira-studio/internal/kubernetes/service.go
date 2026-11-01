package kubernetes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"k8s.io/apimachinery/pkg/version"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/klog/v2"
)

const (
	callTimeout   = 15 * time.Second
	listTimeout   = 30 * time.Second
	statusTimeout = 5 * time.Second

	defaultListPage = 500
	defaultListMax  = 5000
)

// Service is the read-only Kubernetes surface. Methods take a context and return wire types, so
// in-app consumers call it directly; BoundService adds the window streams.
type Service struct {
	store ClusterStore
	emit  appevent.Emitter
	now   func() time.Time
	env   func() Env

	listPage, listMax int

	mu      sync.Mutex
	clients map[string]*clusterClient
	cache   clientCache
	logs    *logRegistry
}

// Option tweaks NewService.
type Option func(*Service)

// WithEnv replaces the login-shell environment probe (a flow-test seam).
func WithEnv(fn func() Env) Option { return func(s *Service) { s.env = fn } }

// WithListLimits sets the page size and row cap of List (a flow-test seam).
func WithListLimits(page, max int) Option {
	return func(s *Service) { s.listPage, s.listMax = page, max }
}

// WithClock replaces the wall clock used for stored timestamps.
func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

var quietKlog sync.Once

// NewService builds the service over the real kubeconfig.
func NewService(store ClusterStore, emit appevent.Emitter, opts ...Option) *Service {
	// client-go logs partial discovery failures to stderr; Status and Kinds report them instead.
	quietKlog.Do(func() {
		klog.LogToStderr(false)
		klog.SetOutput(io.Discard)
	})
	probe := &shellEnv{}
	s := &Service{
		store: store, emit: emit, now: time.Now, env: probe.get,
		listPage: defaultListPage, listMax: defaultListMax,
		clients: map[string]*clusterClient{}, logs: newLogRegistry(),
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// target resolves a stored cluster id against the current kubeconfig.
func (s *Service) target(id string) (loadedConfig, string, *clientcmdapi.Context, error) {
	if id == "" {
		return loadedConfig{}, "", nil, ipcerr.Required("clusterId")
	}
	rec, ok, err := s.store.Get(id)
	if err != nil {
		return loadedConfig{}, "", nil, ipcerr.Internal(err.Error())
	}
	if !ok {
		return loadedConfig{}, "", nil, unknownCluster()
	}
	ld := loadConfig(s.env())
	ctx := ld.cfg.Contexts[rec.Context]
	if ctx == nil || serverOf(ld.cfg, ctx) != rec.Server {
		return loadedConfig{}, "", nil, unknownCluster()
	}
	return ld, rec.Context, ctx, nil
}

func serverOf(cfg *clientcmdapi.Config, ctx *clientcmdapi.Context) string {
	if c := cfg.Clusters[ctx.Cluster]; c != nil {
		return c.Server
	}
	return ""
}

// client returns the cached client set for a cluster, building it when the kubeconfig entry changed.
func (s *Service) client(id string) (*clusterClient, error) {
	ld, name, ctx, err := s.target(id)
	if err != nil {
		return nil, err
	}
	sig := signature(ld.cfg, ctx)
	s.mu.Lock()
	c := s.clients[id]
	s.mu.Unlock()
	if c != nil && c.sig == sig {
		return c, nil
	}
	v, err, _ := s.cache.sf.Do(id+"\x00"+sig, func() (any, error) {
		built, err := buildClient(ld, name, s.env().Path, sig)
		if err != nil {
			return nil, err
		}
		s.mu.Lock()
		s.clients[id] = built
		s.mu.Unlock()
		return built, nil
	})
	if err != nil {
		return nil, err
	}
	return v.(*clusterClient), nil
}

// drop forgets a cluster's client and ends its log streams.
func (s *Service) drop(id string) {
	s.mu.Lock()
	c := s.clients[id]
	delete(s.clients, id)
	s.mu.Unlock()
	if c != nil {
		c.disc.InvalidateWithContext(context.Background())
	}
	s.logs.closeCluster(id)
}

// Clusters lists the kubeconfig contexts, current first, then by name.
func (s *Service) Clusters(context.Context) (ClustersResult, error) {
	ld := loadConfig(s.env())
	res := ClustersResult{Config: ld.info, Clusters: []Cluster{}}
	now := s.now()
	for name, c := range ld.cfg.Contexts {
		server := serverOf(ld.cfg, c)
		rec, err := s.store.Ensure(name, server, now)
		if err != nil {
			return ClustersResult{}, ipcerr.Internal(err.Error())
		}
		res.Clusters = append(res.Clusters, Cluster{
			ID: rec.ID, Context: name, Cluster: c.Cluster, Server: server, User: c.AuthInfo,
			Namespace: c.Namespace, Current: name == ld.cfg.CurrentContext, Source: c.LocationOfOrigin, Mcp: rec.Mcp,
		})
	}
	sort.Slice(res.Clusters, func(i, j int) bool {
		a, b := res.Clusters[i], res.Clusters[j]
		if a.Current != b.Current {
			return a.Current
		}
		return a.Context < b.Context
	})
	return res, nil
}

// Status probes the API server. Cluster trouble comes back as a value; only an unknown id errors.
func (s *Service) Status(ctx context.Context, args StatusArgs) (Status, error) {
	if args.Refresh && args.ClusterID != "" {
		s.drop(args.ClusterID)
	}
	cs, err := s.client(args.ClusterID)
	var ie *ipcerr.Error
	if errors.As(err, &ie) {
		return Status{}, ie
	}
	if err != nil {
		return unavailable(err, ReasonConfig), nil
	}
	cctx, cancel := context.WithTimeout(ctx, statusTimeout)
	defer cancel()
	raw, err := cs.rest.Get().AbsPath("/version").Do(cctx).Raw()
	if err != nil {
		return unavailable(err, ReasonUnreachable), nil
	}
	var info version.Info
	if err := json.Unmarshal(raw, &info); err != nil {
		return unavailable(err, ReasonUnreachable), nil
	}
	return Status{State: StatusOK, ServerVersion: info.GitVersion}, nil
}

func unavailable(err error, fallback string) Status {
	reason := classify(err)
	if reason == "" {
		reason = fallback
	}
	return Status{State: StatusUnavailable, Reason: reason, Message: strings.TrimSpace(err.Error())}
}

const mcpDescriptionMax = 1000

func validMcpMode(m string) bool { return m == "deny" || m == "prompt" || m == "allow" }

// SetMcp validates and stores a cluster's MCP settings and returns what is stored.
func (s *Service) SetMcp(_ context.Context, args SetMcpArgs) (McpSettings, error) {
	if args.ClusterID == "" {
		return McpSettings{}, ipcerr.Required("clusterId")
	}
	m := args.Mcp
	for _, mode := range []string{m.Discover, m.List, m.Describe, m.Logs} {
		if !validMcpMode(mode) {
			return McpSettings{}, ipcerr.T(ipcerr.CodeBadRequest, "backend.studio.kubernetes.badMcpMode.error", map[string]string{"mode": mode})
		}
	}
	if utf8.RuneCountInString(m.Description) > mcpDescriptionMax {
		return McpSettings{}, ipcerr.T(ipcerr.CodeBadRequest, "backend.studio.kubernetes.mcpDescriptionTooLong.error", map[string]string{"max": strconv.Itoa(mcpDescriptionMax)})
	}
	ok, err := s.store.SetMcp(args.ClusterID, m)
	if err != nil {
		return McpSettings{}, ipcerr.Internal(err.Error())
	}
	if !ok {
		return McpSettings{}, unknownCluster()
	}
	return m, nil
}
