package docker

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

const statsEmitInterval = time.Second

// StatsSample is one container's latest resource reading.
type StatsSample struct {
	ID         string  `json:"id"`
	CPUPercent float64 `json:"cpuPercent"`
	MemUsage   uint64  `json:"memUsage"`
	MemLimit   uint64  `json:"memLimit"`
	MemPercent float64 `json:"memPercent"`
	NetRx      uint64  `json:"netRx"`
	NetTx      uint64  `json:"netTx"`
	BlockRead  uint64  `json:"blockRead"`
	BlockWrite uint64  `json:"blockWrite"`
	Pids       uint64  `json:"pids"`
	At         int64   `json:"at"`
}

// StatsEvent is ChannelStats' payload: one aggregated tick for one window.
type StatsEvent struct {
	Samples []StatsSample `json:"samples"`
}

// cpuPercent is the docker CLI's Unix formula over the sample's own previous reading; 0 without one.
func cpuPercent(s container.StatsResponse) float64 {
	cur, pre := s.CPUStats, s.PreCPUStats
	if pre.SystemUsage == 0 || cur.CPUUsage.TotalUsage < pre.CPUUsage.TotalUsage || cur.SystemUsage <= pre.SystemUsage {
		return 0
	}
	cpuDelta := float64(cur.CPUUsage.TotalUsage - pre.CPUUsage.TotalUsage)
	sysDelta := float64(cur.SystemUsage - pre.SystemUsage)
	cpus := float64(cur.OnlineCPUs)
	if cpus == 0 {
		cpus = float64(len(cur.CPUUsage.PercpuUsage))
	}
	if cpuDelta <= 0 || cpus == 0 {
		return 0
	}
	return cpuDelta / sysDelta * cpus * 100
}

// memUsage is usage minus the page cache: cgroup v1 reports total_inactive_file, v2 inactive_file.
func memUsage(s container.StatsResponse) (used, limit uint64) {
	used, limit = s.MemoryStats.Usage, s.MemoryStats.Limit
	cache, ok := s.MemoryStats.Stats["total_inactive_file"]
	if !ok {
		cache = s.MemoryStats.Stats["inactive_file"]
	}
	if cache < used {
		used -= cache
	} else {
		used = 0
	}
	return used, limit
}

func sampleFrom(id string, s container.StatsResponse) StatsSample {
	used, limit := memUsage(s)
	out := StatsSample{ID: id, CPUPercent: cpuPercent(s), MemUsage: used, MemLimit: limit, Pids: s.PidsStats.Current, At: s.Read.UnixMilli()}
	if limit > 0 {
		out.MemPercent = float64(used) / float64(limit) * 100
	}
	for _, n := range s.Networks {
		out.NetRx += n.RxBytes
		out.NetTx += n.TxBytes
	}
	for _, e := range s.BlkioStats.IoServiceBytesRecursive {
		switch strings.ToLower(e.Op) {
		case "read":
			out.BlockRead += e.Value
		case "write":
			out.BlockWrite += e.Value
		}
	}
	return out
}

// statsSource opens one container's engine stats stream; a seam for the hub test.
type statsSource interface {
	open(ctx context.Context, id string) (io.ReadCloser, error)
}

type engineStats struct{ m *Manager }

func (s engineStats) open(ctx context.Context, id string) (io.ReadCloser, error) {
	cli, _, err := s.m.client()
	if err != nil {
		return nil, err
	}
	res, err := cli.ContainerStats(ctx, id, client.ContainerStatsOptions{Stream: true})
	if err != nil {
		return nil, err
	}
	return res.Body, nil
}

type statStream struct {
	cancel context.CancelFunc
	latest *StatsSample
}

type windowSubs struct {
	ids  map[string]struct{}
	stop context.CancelFunc // ends the window's emit ticker
}

// statsHub shares one engine stats stream per container across every window subscribed to it and
// emits each window one aggregated sample batch per interval.
type statsHub struct {
	src      statsSource
	emit     func(windowKey string, ev StatsEvent)
	interval time.Duration

	mu      sync.Mutex
	windows map[string]*windowSubs
	streams map[string]*statStream
}

func newStatsHub(src statsSource, emit func(string, StatsEvent), interval time.Duration) *statsHub {
	return &statsHub{src: src, emit: emit, interval: interval, windows: map[string]*windowSubs{}, streams: map[string]*statStream{}}
}

// subscribe replaces windowKey's container set.
func (h *statsHub) subscribe(windowKey string, ids []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(ids) == 0 {
		h.dropWindowLocked(windowKey)
		h.reconcileLocked()
		return
	}
	set := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		set[id] = struct{}{}
	}
	w := h.windows[windowKey]
	if w == nil {
		ctx, cancel := context.WithCancel(context.Background())
		w = &windowSubs{stop: cancel}
		h.windows[windowKey] = w
		go h.tick(ctx, windowKey)
	}
	w.ids = set
	h.reconcileLocked()
}

func (h *statsHub) unsubscribe(windowKey string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.dropWindowLocked(windowKey)
	h.reconcileLocked()
}

func (h *statsHub) reset() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for key := range h.windows {
		h.dropWindowLocked(key)
	}
	h.reconcileLocked()
}

func (h *statsHub) dropWindowLocked(windowKey string) {
	if w := h.windows[windowKey]; w != nil {
		w.stop()
		delete(h.windows, windowKey)
	}
}

// reconcileLocked starts a stream for each wanted container and cancels any nobody wants.
func (h *statsHub) reconcileLocked() {
	wanted := map[string]struct{}{}
	for _, w := range h.windows {
		for id := range w.ids {
			wanted[id] = struct{}{}
		}
	}
	for id, st := range h.streams {
		if _, ok := wanted[id]; !ok {
			st.cancel()
			delete(h.streams, id)
		}
	}
	for id := range wanted {
		if _, ok := h.streams[id]; ok {
			continue
		}
		ctx, cancel := context.WithCancel(context.Background())
		st := &statStream{cancel: cancel}
		h.streams[id] = st
		go h.run(ctx, id, st)
	}
}

func (h *statsHub) run(ctx context.Context, id string, st *statStream) {
	defer func() {
		h.mu.Lock()
		st.latest = nil
		if h.streams[id] == st {
			delete(h.streams, id)
		}
		h.mu.Unlock()
	}()
	body, err := h.src.open(ctx, id)
	if err != nil {
		return
	}
	defer body.Close()
	dec := json.NewDecoder(body)
	for ctx.Err() == nil {
		var resp container.StatsResponse
		if err := dec.Decode(&resp); err != nil {
			return
		}
		sample := sampleFrom(id, resp)
		h.mu.Lock()
		st.latest = &sample
		h.mu.Unlock()
	}
}

func (h *statsHub) tick(ctx context.Context, windowKey string) {
	t := time.NewTicker(h.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		h.mu.Lock()
		w := h.windows[windowKey]
		var samples []StatsSample
		if w != nil {
			for id := range w.ids {
				if st := h.streams[id]; st != nil && st.latest != nil {
					samples = append(samples, *st.latest)
				}
			}
		}
		h.mu.Unlock()
		if len(samples) > 0 {
			h.emit(windowKey, StatsEvent{Samples: samples})
		}
	}
}
