package bridge_test

import (
	"sync"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/metrics"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// recordingEmitter implements appcore.Emitter and records every Emit call for assertion.
type recordingEmitter struct {
	mu   sync.Mutex
	recs []emitted
}

type emitted struct {
	name string
	data any
}

func (r *recordingEmitter) Emit(name string, data any) {
	r.mu.Lock()
	r.recs = append(r.recs, emitted{name, data})
	r.mu.Unlock()
}

func (r *recordingEmitter) all() []emitted {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]emitted(nil), r.recs...)
}

// fakeConnectionsSource is Sources.Connections, driven directly by a test. Each handler is
// cleared (not merely counted) on unsubscribe, so emitting after detach is a real test of
// "nothing fires", not just a call-count check.
type fakeConnectionsSource struct {
	stateHandler       func(model.ConnectionState)
	invalidatedHandler func(string)
	listHandler        func([]model.ConnectionSummary)
	unsubCounts        map[string]int
}

func newFakeConnectionsSource() *fakeConnectionsSource {
	return &fakeConnectionsSource{unsubCounts: map[string]int{}}
}

func (f *fakeConnectionsSource) OnStateChange(fn func(model.ConnectionState)) func() {
	f.stateHandler = fn
	return func() { f.unsubCounts["state"]++; f.stateHandler = nil }
}

func (f *fakeConnectionsSource) OnMetadataInvalidated(fn func(string)) func() {
	f.invalidatedHandler = fn
	return func() { f.unsubCounts["invalidated"]++; f.invalidatedHandler = nil }
}

func (f *fakeConnectionsSource) OnListChanged(fn func([]model.ConnectionSummary)) func() {
	f.listHandler = fn
	return func() { f.unsubCounts["list"]++; f.listHandler = nil }
}

func (f *fakeConnectionsSource) emitState(st model.ConnectionState) {
	if f.stateHandler != nil {
		f.stateHandler(st)
	}
}

func (f *fakeConnectionsSource) emitInvalidated(id string) {
	if f.invalidatedHandler != nil {
		f.invalidatedHandler(id)
	}
}

func (f *fakeConnectionsSource) emitList(list []model.ConnectionSummary) {
	if f.listHandler != nil {
		f.listHandler(list)
	}
}

// fakeOplogSource is Sources.Oplog.
type fakeOplogSource struct {
	handler    func(model.OpRecord)
	unsubCount int
}

func (f *fakeOplogSource) OnUpdate(fn func(model.OpRecord)) func() {
	f.handler = fn
	return func() { f.unsubCount++; f.handler = nil }
}

func (f *fakeOplogSource) emit(rec model.OpRecord) {
	if f.handler != nil {
		f.handler(rec)
	}
}

// fakeMetricsSource is Sources.Metrics.
type fakeMetricsSource struct {
	handler    func(metrics.Sample)
	unsubCount int
}

func (f *fakeMetricsSource) OnSample(fn func(metrics.Sample)) func() {
	f.handler = fn
	return func() { f.unsubCount++; f.handler = nil }
}

func (f *fakeMetricsSource) emit(sample metrics.Sample) {
	if f.handler != nil {
		f.handler(sample)
	}
}

func newFakeSources() (bridge.Sources, *fakeConnectionsSource, *fakeOplogSource, *fakeMetricsSource) {
	conns := newFakeConnectionsSource()
	oplog := &fakeOplogSource{}
	met := &fakeMetricsSource{}
	return bridge.Sources{Connections: conns, Oplog: oplog, Metrics: met}, conns, oplog, met
}

func TestChannelConstantsMatchIpcTs(t *testing.T) {
	tests := []struct {
		name string
		got  string
		want string
	}{
		{"OpenSettings", bridge.ChannelOpenSettings, "kira:open-settings"},
		{"NewConnection", bridge.ChannelNewConnection, "kira:menu:new-connection"},
		{"ToggleProjectPanel", bridge.ChannelToggleProjectPanel, "kira:menu:toggle-project-panel"},
		{"ToggleOperationsPanel", bridge.ChannelToggleOperationsPanel, "kira:menu:toggle-operations-panel"},
		{"CommandPalette", bridge.ChannelCommandPalette, "kira:menu:command-palette"},
		{"TabNext", bridge.ChannelTabNext, "kira:menu:tab-next"},
		{"TabPrev", bridge.ChannelTabPrev, "kira:menu:tab-prev"},
		{"TabClose", bridge.ChannelTabClose, "kira:menu:tab-close"},
		{"ViewFind", bridge.ChannelViewFind, "kira:menu:view-find"},
		{"ViewRefresh", bridge.ChannelViewRefresh, "kira:menu:view-refresh"},
		{"ViewRun", bridge.ChannelViewRun, "kira:menu:view-run"},
		{"ViewRunAll", bridge.ChannelViewRunAll, "kira:menu:view-run-all"},
		{"FlushBeforeClose", bridge.ChannelFlushBeforeClose, "kira:app:flush-before-close"},
		{"ConnectionState", bridge.ChannelConnectionState, "kira:connection:state"},
		{"MetadataInvalidated", bridge.ChannelMetadataInvalidated, "kira:connection:metadataInvalidated"},
		{"ConnectionsChanged", bridge.ChannelConnectionsChanged, "kira:connections:changed"},
		{"SettingsChanged", bridge.ChannelSettingsChanged, "kira:settings:changed"},
		{"OpUpdate", bridge.ChannelOpUpdate, "kira:op:update"},
		{"AppMetrics", bridge.ChannelAppMetrics, "kira:app:metrics"},
		{"EngineState", bridge.ChannelEngineState, "kira:engine:state"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.want {
				t.Errorf("%s = %q, want %q", tt.name, tt.got, tt.want)
			}
		})
	}
}

func TestSignalEmitsNilPayload(t *testing.T) {
	rec := &recordingEmitter{}
	ev := bridge.NewEvents(rec)
	ev.Signal(bridge.ChannelTabNext)

	got := rec.all()
	if len(got) != 1 {
		t.Fatalf("got %d emissions, want 1", len(got))
	}
	if got[0].name != bridge.ChannelTabNext || got[0].data != nil {
		t.Errorf("emission = %+v, want {%s, nil}", got[0], bridge.ChannelTabNext)
	}
}

func TestAttachForwardsEveryProducer(t *testing.T) {
	rec := &recordingEmitter{}
	ev := bridge.NewEvents(rec)
	sources, conns, oplog, met := newFakeSources()
	detach := ev.Attach(sources)
	defer detach()

	wantState := model.ConnectionState{ConnectionID: "c1", Status: "connected"}
	wantOp := model.OpRecord{ID: "op1", Kind: "read", Status: "ok"}
	wantSample := metrics.Sample{CPUPercent: 1.5, MemoryBytes: 1024}
	wantList := []model.ConnectionSummary{{ID: "c1"}}

	conns.emitState(wantState)
	conns.emitInvalidated("c1")
	conns.emitList(wantList)
	oplog.emit(wantOp)
	met.emit(wantSample)

	got := rec.all()
	if len(got) != 5 {
		t.Fatalf("got %d emissions, want 5: %+v", len(got), got)
	}

	checks := []struct {
		idx  int
		name string
		want any
	}{
		{0, bridge.ChannelConnectionState, wantState},
		{1, bridge.ChannelMetadataInvalidated, "c1"},
		{2, bridge.ChannelConnectionsChanged, wantList},
		{3, bridge.ChannelOpUpdate, wantOp},
		{4, bridge.ChannelAppMetrics, wantSample},
	}
	for _, c := range checks {
		if got[c.idx].name != c.name {
			t.Errorf("emission[%d].name = %q, want %q", c.idx, got[c.idx].name, c.name)
		}
		if diff := cmp.Diff(c.want, got[c.idx].data); diff != "" {
			t.Errorf("emission[%d].data mismatch (-want +got):\n%s", c.idx, diff)
		}
	}
}

func TestDetachUnsubscribesAll(t *testing.T) {
	rec := &recordingEmitter{}
	ev := bridge.NewEvents(rec)
	sources, conns, oplog, met := newFakeSources()
	detach := ev.Attach(sources)
	detach()

	if got := conns.unsubCounts["state"]; got != 1 {
		t.Errorf("state unsubscribe called %d times, want 1", got)
	}
	if got := conns.unsubCounts["invalidated"]; got != 1 {
		t.Errorf("invalidated unsubscribe called %d times, want 1", got)
	}
	if got := conns.unsubCounts["list"]; got != 1 {
		t.Errorf("list unsubscribe called %d times, want 1", got)
	}
	if oplog.unsubCount != 1 {
		t.Errorf("oplog unsubscribe called %d times, want 1", oplog.unsubCount)
	}
	if met.unsubCount != 1 {
		t.Errorf("metrics unsubscribe called %d times, want 1", met.unsubCount)
	}

	conns.emitState(model.ConnectionState{ConnectionID: "c2"})
	conns.emitInvalidated("c2")
	conns.emitList([]model.ConnectionSummary{{ID: "c2"}})
	oplog.emit(model.OpRecord{ID: "op2"})
	met.emit(metrics.Sample{})

	if got := rec.all(); len(got) != 0 {
		t.Errorf("got %d emissions after detach, want 0: %+v", len(got), got)
	}
}

func TestEngineStateIsNeverEmitted(t *testing.T) {
	rec := &recordingEmitter{}
	ev := bridge.NewEvents(rec)
	sources, conns, oplog, met := newFakeSources()
	detach := ev.Attach(sources)
	defer detach()

	conns.emitState(model.ConnectionState{ConnectionID: "c1"})
	conns.emitInvalidated("c1")
	conns.emitList([]model.ConnectionSummary{{ID: "c1"}})
	oplog.emit(model.OpRecord{ID: "op1"})
	met.emit(metrics.Sample{})
	ev.Signal(bridge.ChannelTabNext)
	ev.SettingsChanged(model.DefaultSettings())

	for _, e := range rec.all() {
		if e.name == bridge.ChannelEngineState {
			t.Fatalf("kira:engine:state was emitted (P56 D5 regression): %+v", e)
		}
	}
}
