package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/modelstore"
	"github.com/kirathecat/kira-studio/internal/memory/stt"
)

// ChannelMemoryDictation fires when dictation status or model download progress changes. The
// payload is empty; the UI refetches DictationService.Status.
const ChannelMemoryDictation = "kira:memory:dictation"

// DictationStreamName is the named Wails stream carrying one dictation session's frames.
const DictationStreamName = "dictation"

const (
	glossaryRecent  = 100
	glossaryTerms   = 40
	glossaryTimeout = 2 * time.Second
)

// DictationState values mirror stt.State plus a download in progress.
const dictationDownloading = "downloading"

// DictationStatus is the Memory module's speech-to-text availability. Done and Total are bytes
// while State is "downloading".
type DictationStatus struct {
	State   string `json:"state"`
	Message string `json:"message"`
	Done    int64  `json:"done"`
	Total   int64  `json:"total"`
}

// DictationService is the Memory module's local speech to text: model download, status, and (through
// ServeDictationStream) live sessions. A separate bound service from MemoryService so the
// microphone surface stays one concern.
type DictationService struct {
	events appcore.Emitter
	mem    *MemoryService

	mu     sync.Mutex
	client *stt.Client

	// installing serialises model downloads; progress is read by Status.
	installing sync.Mutex
	dlMu       sync.Mutex
	dlActive   bool
	dlDone     int64
	dlTotal    int64

	statusEvents *coalescer
}

func NewDictationService(events appcore.Emitter, mem *MemoryService) *DictationService {
	s := &DictationService{events: events, mem: mem}
	s.statusEvents = newCoalescer(emitGap, func() { events.Emit(ChannelMemoryDictation, struct{}{}) })
	return s
}

// sttClient creates the speech client on first use; creating it spawns nothing.
func (s *DictationService) sttClient() *stt.Client {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client == nil {
		s.client = stt.NewClient(stt.ClientOptions{Spec: stt.Default, Home: memory.Home(), OnState: s.statusEvents.Trigger})
	}
	return s.client
}

// CloseDictation stops the speech worker. A package-level function, not a method: Wails binds
// every exported method of a registered service.
func CloseDictation(s *DictationService) {
	s.mu.Lock()
	c := s.client
	s.client = nil
	s.mu.Unlock()
	if c != nil {
		_ = c.Close()
	}
}

// Status reports availability, overlaid with download progress while a model install runs.
func (s *DictationService) Status() DictationStatus {
	s.dlMu.Lock()
	if s.dlActive {
		st := DictationStatus{State: dictationDownloading, Done: s.dlDone, Total: s.dlTotal}
		s.dlMu.Unlock()
		return st
	}
	s.dlMu.Unlock()
	st := s.sttClient().Status()
	return DictationStatus{State: string(st.State), Message: st.Message}
}

func (s *DictationService) setDownload(active bool, done, total int64) {
	s.dlMu.Lock()
	s.dlActive, s.dlDone, s.dlTotal = active, done, total
	s.dlMu.Unlock()
	s.statusEvents.Trigger()
}

// InstallModel downloads the speech model into the shared memory home. One download at a time;
// cancelling the call aborts it. The click that calls this is the opt-in: nothing downloads
// before it.
func (s *DictationService) InstallModel(ctx context.Context) error {
	if !stt.Built {
		return ipcerr.BadRequest("dictation is not available in this build")
	}
	if !s.installing.TryLock() {
		return ipcerr.BadRequest("already downloading")
	}
	defer s.installing.Unlock()
	client := s.sttClient()
	spec := client.Spec()

	s.setDownload(true, 0, spec.TotalSize())
	err := modelstore.Install(ctx, client.Dir(), spec.ID, spec.Files, func(done, total int64) {
		s.dlMu.Lock()
		s.dlDone, s.dlTotal = done, total
		s.dlMu.Unlock()
		s.statusEvents.Trigger()
	})
	s.setDownload(false, 0, 0)
	if err != nil {
		return memoryErr(err)
	}
	client.Reset()
	return nil
}

// Retry clears a recorded worker failure and its spawn backoff.
func (s *DictationService) Retry() {
	s.sttClient().Reset()
}

// glossary is the memory keywords seen most often among current memories, so dictated names and
// jargon the user already stores bias the decoder. It is one cheap local query per session.
func (s *DictationService) glossary(ctx context.Context) []string {
	ctx, cancel := context.WithTimeout(ctx, glossaryTimeout)
	defer cancel()
	ms, err := s.mem.service().Recent(ctx, glossaryRecent)
	if err != nil {
		return nil
	}
	return topKeywords(ms, glossaryTerms)
}

func topKeywords(ms []memory.Memory, n int) []string {
	count := map[string]int{}
	for _, m := range ms {
		for _, k := range m.Keywords {
			if k != "" {
				count[k]++
			}
		}
	}
	terms := make([]string, 0, len(count))
	for k := range count {
		terms = append(terms, k)
	}
	sort.Slice(terms, func(i, j int) bool {
		if count[terms[i]] != count[terms[j]] {
			return count[terms[i]] > count[terms[j]]
		}
		return terms[i] < terms[j]
	})
	return terms[:min(n, len(terms))]
}

// DictationConn is what ServeDictationStream needs from a renderer connection;
// *application.StreamConn satisfies it, so this package still imports no Wails.
type DictationConn interface {
	StreamSession
	Context() context.Context
	Close() error
}

type dictationCommand struct {
	Type string `json:"type"`
}

// ServeDictationStream runs one dictation session over conn: opening the stream starts it, a
// {"type":"stop"} frame finalises it, and closing the stream (a reload, a window close) cancels
// it. Server frames are stt.Frame JSON. The stream closes when the session ends.
func ServeDictationStream(s *DictationService, conn DictationConn) {
	defer conn.Close()
	var sendMu sync.Mutex
	send := func(f stt.Frame) {
		b, err := json.Marshal(f)
		if err != nil {
			return
		}
		sendMu.Lock()
		defer sendMu.Unlock()
		_ = conn.Send(b)
	}

	client := s.sttClient()
	d, err := client.Dictate(conn.Context(), stt.DictateOptions{Glossary: s.glossary(conn.Context()), Emit: send})
	if err != nil {
		send(stt.Frame{Type: "error", Code: dictateErrCode(err), Message: err.Error()})
		return
	}
	go func() {
		for {
			msg, err := conn.Receive()
			if err != nil {
				d.Cancel()
				return
			}
			var cmd dictationCommand
			if json.Unmarshal(msg, &cmd) != nil {
				continue
			}
			switch cmd.Type {
			case "stop":
				d.Stop()
			case "cancel":
				d.Cancel()
			}
		}
	}()
	<-d.Done()
}

func dictateErrCode(err error) string {
	switch {
	case errors.Is(err, stt.ErrBusy):
		return "busy"
	case errors.Is(err, stt.ErrNotInstalled):
		return "notInstalled"
	}
	return "worker"
}
