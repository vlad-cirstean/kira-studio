package bridge

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsock"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// fakeEmitter is a minimal appcore.Emitter recording every Emit call — this test's own stand-in,
// since AttachPush only ever calls Deps.Events.Emit (never EmitTo/EmitFocused).
type fakeEmitter struct {
	emits []struct {
		name string
		data any
	}
}

func (f *fakeEmitter) Emit(name string, data any) {
	f.emits = append(f.emits, struct {
		name string
		data any
	}{name, data})
}
func (f *fakeEmitter) EmitTo(string, string, any) {}
func (f *fakeEmitter) EmitFocused(string, any)    {}

// fakePushSock/fakePushBroker capture the single subscriber AttachPush installs, so the test can
// fire it directly rather than standing up a real socket/broker — F1's own bug was that nothing
// ever called Subscribe/OnClientsChanged at all, which this asserts directly.
type fakePushSock struct {
	onClientsChanged func([]model.GitClient)
}

func (s *fakePushSock) Revoke(string) error { return nil }
func (s *fakePushSock) OnClientsChanged(fn func([]model.GitClient)) (unsubscribe func()) {
	s.onClientsChanged = fn
	return func() { s.onClientsChanged = nil }
}

type fakePushBroker struct {
	onPairingChanged func(gitsock.PairingSnapshot)
}

func (b *fakePushBroker) Pending() gitsock.PairingSnapshot           { return gitsock.PairingSnapshot{} }
func (b *fakePushBroker) Approve(string) gitsock.PairingActionResult { return 0 }
func (b *fakePushBroker) Deny(string) gitsock.PairingActionResult    { return 0 }
func (b *fakePushBroker) Subscribe(fn func(gitsock.PairingSnapshot)) (unsubscribe func()) {
	b.onPairingChanged = fn
	return func() { b.onPairingChanged = nil }
}

// TestGitClientsService_AttachPush guards F1: gitsock's two change feeds must reach the renderer
// on ChannelGitPairing/ChannelGitClientsChanged, and unsubscribe must actually stop delivery
// (teardown calls it before gitSock.Close(); a leaked subscriber would fire into a torn-down app).
func TestGitClientsService_AttachPush(t *testing.T) {
	emitter := &fakeEmitter{}
	sock := &fakePushSock{}
	broker := &fakePushBroker{}
	svc := &GitClientsService{
		Deps:   appcore.Deps{Events: emitter},
		Sock:   sock,
		Broker: broker,
	}

	detach := svc.AttachPush()
	if sock.onClientsChanged == nil || broker.onPairingChanged == nil {
		t.Fatal("AttachPush did not subscribe to both feeds")
	}

	broker.onPairingChanged(gitsock.PairingSnapshot{Queued: 2})
	sock.onClientsChanged([]model.GitClient{{ID: "c1"}})

	if len(emitter.emits) != 2 {
		t.Fatalf("want 2 emits, got %d: %+v", len(emitter.emits), emitter.emits)
	}
	if emitter.emits[0].name != ChannelGitPairing {
		t.Errorf("emit 0 channel = %q, want %q", emitter.emits[0].name, ChannelGitPairing)
	}
	snap, ok := emitter.emits[0].data.(GitPairingSnapshot)
	if !ok || snap.Queued != 2 {
		t.Errorf("emit 0 payload = %+v, want wire snapshot with Queued=2", emitter.emits[0].data)
	}
	if emitter.emits[1].name != ChannelGitClientsChanged {
		t.Errorf("emit 1 channel = %q, want %q", emitter.emits[1].name, ChannelGitClientsChanged)
	}
	clients, ok := emitter.emits[1].data.([]model.GitClient)
	if !ok || len(clients) != 1 || clients[0].ID != "c1" {
		t.Errorf("emit 1 payload = %+v, want one client c1", emitter.emits[1].data)
	}

	detach()
	if sock.onClientsChanged != nil || broker.onPairingChanged != nil {
		t.Error("detach did not unsubscribe both feeds")
	}
}
