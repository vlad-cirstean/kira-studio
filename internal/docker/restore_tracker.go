package docker

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

const (
	restorePruneAfter = 30 * 24 * time.Hour
	labelComposeDeps  = "com.docker.compose.depends_on"
)

// BootProbe reads the engine's boot marker: the default bridge network's ID and creation time (ms).
// It is a flow-test seam; "" means the engine has no default bridge.
type BootProbe func(ctx context.Context, cli *client.Client) (id string, at int64, err error)

func bridgeBootProbe(ctx context.Context, cli *client.Client) (string, int64, error) {
	res, err := cli.NetworkInspect(ctx, "bridge", client.NetworkInspectOptions{})
	if err != nil {
		if cerrdefs.IsNotFound(err) {
			return "", 0, nil
		}
		return "", 0, err
	}
	return res.Network.ID, res.Network.Created.UnixMilli(), nil
}

// restoreExcluded are origins whose orchestrator or tooling owns the container's lifecycle.
func restoreExcluded(origin string) bool {
	switch origin {
	case "testcontainers", "buildx", "kind", "kubernetes", "swarm":
		return true
	}
	return false
}

// restoreTracker keeps the last known running set of each engine and detects an engine restart.
// It runs without any window open.
type restoreTracker struct {
	m     *Manager
	store RestoreStore
	t     restoreTiming
	probe BootProbe

	kickCh chan struct{}
	cancel context.CancelFunc
	done   chan struct{}

	tickMu sync.Mutex // serializes ticks

	mu               sync.Mutex
	snaps            map[string]*RestoreSnapshot // by Info.ID; DB is read on first sight only
	lastKey          map[string]string           // last emitted state per engine
	errs             map[string]string           // container ID -> last Restore failure
	inspected        map[string]inspectedFacts   // restart policy and --rm per live container
	unreachableSince int64
	reachable        bool
	cur              RestoreState
	curObs           observation
}

func newRestoreTracker(m *Manager) *restoreTracker {
	probe := m.bootProbe
	if probe == nil {
		probe = bridgeBootProbe
	}
	return &restoreTracker{
		m: m, store: m.restoreStore, t: m.restoreTiming, probe: probe, kickCh: make(chan struct{}, 1),
		snaps: map[string]*RestoreSnapshot{}, lastKey: map[string]string{}, errs: map[string]string{},
		inspected: map[string]inspectedFacts{}, cur: RestoreState{State: "none", Items: []RestoreItem{}},
	}
}

func nowMs() int64 { return time.Now().UnixMilli() }

// start launches the loop once.
func (r *restoreTracker) start() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel, r.done = cancel, make(chan struct{})
	go r.run(ctx, r.done)
}

func (r *restoreTracker) stop() {
	if r == nil {
		return
	}
	r.mu.Lock()
	cancel, done := r.cancel, r.done
	r.cancel = nil
	r.mu.Unlock()
	if cancel != nil {
		cancel()
		<-done
	}
}

// kick asks for a tick soon; calls coalesce.
func (r *restoreTracker) kick() {
	if r == nil {
		return
	}
	select {
	case r.kickCh <- struct{}{}:
	default:
	}
}

// contextChanged forgets the outage clock of the previous engine and ticks.
func (r *restoreTracker) contextChanged() {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.unreachableSince = 0
	r.mu.Unlock()
	r.kick()
}

func (r *restoreTracker) run(ctx context.Context, done chan struct{}) {
	defer close(done)
	if err := r.store.PruneRestore(nowMs() - restorePruneAfter.Milliseconds()); err != nil {
		slog.Warn("prune docker restore snapshots", "scope", "docker", "err", err)
	}
	r.tickGated(ctx)
	for {
		r.mu.Lock()
		wait := r.t.tick
		if !r.reachable {
			wait = r.t.down()
		}
		r.mu.Unlock()
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		case <-r.kickCh:
			timer.Stop()
			sleepCtx(ctx, min(500*time.Millisecond, r.t.tick))
			select {
			case <-r.kickCh:
			default:
			}
		}
		if ctx.Err() != nil {
			return
		}
		r.tickGated(ctx)
	}
}

// tickGated skips background ticks on a remote endpoint no window watches: an ssh endpoint would hold a session open all day.
func (r *restoreTracker) tickGated(ctx context.Context) {
	if r.m.endpointRemote() && !r.m.events.watching() {
		return
	}
	r.tick(ctx)
}

func (r *restoreTracker) markDown() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.reachable = false
	if r.unreachableSince == 0 {
		r.unreachableSince = nowMs()
	}
}

// tick observes the engine once and folds the result into its snapshot. An unreachable engine
// changes nothing.
func (r *restoreTracker) tick(ctx context.Context) {
	r.tickMu.Lock()
	defer r.tickMu.Unlock()
	cli, ep, err := r.m.client()
	if err != nil {
		r.markDown()
		return
	}
	pctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	if _, err := cli.Ping(pctx, client.PingOptions{NegotiateAPIVersion: true}); err != nil {
		r.markDown()
		return
	}
	info, err := cli.Info(pctx, client.InfoOptions{})
	if err != nil || info.Info.ID == "" {
		r.markDown()
		return
	}
	engineID := info.Info.ID
	bootID, bootAt, err := r.probe(pctx, cli)
	if err != nil {
		r.markDown()
		return
	}
	list, err := cli.ContainerList(pctx, client.ContainerListOptions{All: true})
	if err != nil {
		r.markDown()
		return
	}

	prev := r.snapshot(engineID)
	o := observation{EngineID: engineID, Context: ep.Context, Host: ep.Host, BootID: bootID, BootAt: bootAt}
	r.mu.Lock()
	o.UnreachableSince = r.unreachableSince
	r.mu.Unlock()
	o.Containers = r.observe(pctx, cli, list.Items, prev, o)

	now := nowMs()
	next, changed := reconcile(prev, o, now, r.t)
	if changed || prev == nil {
		changed = r.save(next)
	}
	r.mu.Lock()
	r.reachable, r.unreachableSince = true, 0
	if changed {
		r.snaps[engineID] = &next
	}
	r.mu.Unlock()
	r.publish(&next, o, now)
}

// save persists next; false means the cache must keep the old snapshot so the next tick retries.
func (r *restoreTracker) save(next RestoreSnapshot) bool {
	if err := r.store.SaveRestore(next); err != nil {
		slog.Warn("save docker restore snapshot", "scope", "docker", "err", err)
		return false
	}
	return true
}

// publish records the engine's wire state and pushes it when it differs from the last push.
func (r *restoreTracker) publish(s *RestoreSnapshot, o observation, now int64) {
	r.mu.Lock()
	st := buildState(s, o, now, r.t)
	r.annotateLocked(&st)
	r.cur, r.curObs = st, o
	key := stateKey(st)
	last := r.lastKey[o.EngineID]
	emit := key != last && (last != "" || st.State == statePending)
	r.lastKey[o.EngineID] = key
	r.mu.Unlock()
	if emit {
		r.m.Emit.Emit(ChannelRestore, st)
	}
}

type inspectedFacts struct {
	policy     string
	autoRemove bool
}

func stateKey(st RestoreState) string {
	b, _ := json.Marshal(st)
	return string(b)
}

// annotateLocked attaches the last Restore failure to each item.
func (r *restoreTracker) annotateLocked(st *RestoreState) {
	for i := range st.Items {
		st.Items[i].Error = r.errs[st.Items[i].ID]
	}
}

// snapshot returns the cached snapshot, reading the DB on first sight of the engine.
func (r *restoreTracker) snapshot(engineID string) *RestoreSnapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.snaps[engineID]; ok {
		return s
	}
	s, found, err := r.store.LoadRestore(engineID)
	if err != nil {
		slog.Warn("load docker restore snapshot", "scope", "docker", "err", err)
		return nil
	}
	if !found {
		return nil
	}
	r.snaps[engineID] = &s
	return &s
}

// observe turns the container list into observations, inspecting only what the list cannot say:
// restart policy and --rm for containers about to be snapshotted, FinishedAt in the no-bridge fallback.
func (r *restoreTracker) observe(ctx context.Context, cli *client.Client, items []container.Summary, prev *RestoreSnapshot, o observation) []obsContainer {
	known := map[string]string{}
	noBridgeOutage := false
	if prev != nil {
		noBridgeOutage = prev.BootID == "" && o.BootID == "" && o.UnreachableSince > 0
		for _, e := range prev.Entries {
			known[e.ID] = e.RestartPolicy
		}
	}
	live := map[string]struct{}{}
	out := make([]obsContainer, 0, len(items))
	for _, s := range items {
		c := obsContainer{
			ID: s.ID, Name: trimName(s.Names), Image: s.Image, Project: s.Labels[labelComposeProject],
			Service: s.Labels[labelComposeService], DependsOn: s.Labels[labelComposeDeps],
			Running: s.State == "running" || s.State == "restarting" || s.State == "paused",
		}
		origin, _ := originOf(s.Labels, c.Name)
		c.Excluded = restoreExcluded(origin)
		live[c.ID] = struct{}{}
		policy, isKnown := known[c.ID]
		c.Policy = policy
		switch {
		case c.Running && !c.Excluded && !isKnown:
			r.mu.Lock()
			f, cached := r.inspected[c.ID]
			r.mu.Unlock()
			if !cached {
				res, err := cli.ContainerInspect(ctx, c.ID, client.ContainerInspectOptions{})
				if err != nil || res.Container.HostConfig == nil {
					c.Excluded = true // retried next tick
					break
				}
				f = inspectedFacts{string(res.Container.HostConfig.RestartPolicy.Name), res.Container.HostConfig.AutoRemove}
				r.mu.Lock()
				r.inspected[c.ID] = f
				r.mu.Unlock()
			}
			c.Policy, c.AutoRemove = f.policy, f.autoRemove
		case !c.Running && isKnown && noBridgeOutage:
			if res, err := cli.ContainerInspect(ctx, c.ID, client.ContainerInspectOptions{}); err == nil && res.Container.State != nil {
				if t, err := time.Parse(time.RFC3339Nano, res.Container.State.FinishedAt); err == nil {
					c.FinishedAt = t.UnixMilli()
				}
			}
		}
		out = append(out, c)
	}
	r.mu.Lock()
	for id := range r.inspected {
		if _, ok := live[id]; !ok {
			delete(r.inspected, id)
		}
	}
	r.mu.Unlock()
	return out
}
