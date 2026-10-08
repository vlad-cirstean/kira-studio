package mobileweb

import (
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

func TestIdempotency_ReplayMismatchInFlightAndExpiry(t *testing.T) {
	t.Parallel()
	s, store, _ := newTestServer(t)
	writer := s.cfg.Writer.(*fakeWriter)
	cookie := store.addDeviceWith(t, "dev1", true, false)
	move := `{"id":"b1","toIndex":2}`

	first := postJSON(s, "/api/ade/backlog/move", cookie, idemA, move)
	replay := postJSON(s, "/api/ade/backlog/move", cookie, idemA, move)
	if first.Code != 200 || replay.Code != 200 || replay.Header().Get("Idempotent-Replay") != "true" {
		t.Fatalf("first %d, replay %d %v", first.Code, replay.Code, replay.Header())
	}
	if writer.count() != 1 {
		t.Fatalf("a replayed key ran the move %d times", writer.count())
	}
	if rec := postJSON(s, "/api/ade/backlog/items", cookie, idemA, `{"text":"x"}`); rec.Code != http.StatusUnprocessableEntity || errCode(t, rec) != "E_IDEMPOTENCY_MISMATCH" {
		t.Errorf("same key on another path: %d %s", rec.Code, rec.Body)
	}
	if rec := postJSON(s, "/api/ade/backlog/move", store.addDeviceWith(t, "dev2", true, false), idemA, move); rec.Code != 200 || writer.count() != 2 {
		t.Errorf("keys are per device: %d, %d calls", rec.Code, writer.count())
	}

	// A 5xx is not cached: the same key runs again.
	writer.mu.Lock()
	writer.err = errors.New("boom")
	writer.mu.Unlock()
	key := uuid.NewString()
	if rec := postJSON(s, "/api/ade/backlog/move", cookie, key, move); rec.Code != 500 {
		t.Fatalf("service failure: %d", rec.Code)
	}
	writer.mu.Lock()
	writer.err = nil
	writer.mu.Unlock()
	if rec := postJSON(s, "/api/ade/backlog/move", cookie, key, move); rec.Code != 200 || writer.count() != 4 {
		t.Errorf("retry after 5xx: %d, %d calls", rec.Code, writer.count())
	}

	// A 4xx is cached: a retry replays the same refusal.
	writer.mu.Lock()
	writer.err = ipcerr.New("E_STALE", "moved")
	writer.mu.Unlock()
	stale := uuid.NewString()
	for range 2 {
		if rec := postJSON(s, "/api/ade/backlog/move", cookie, stale, move); rec.Code != http.StatusConflict {
			t.Errorf("stale: %d", rec.Code)
		}
	}
	if writer.count() != 5 {
		t.Errorf("a cached 4xx ran the service %d times", writer.count())
	}
}

func TestIdempotency_InFlightKey(t *testing.T) {
	t.Parallel()
	st := newIdemStore(time.Minute)
	e, out := st.begin("d", "k", "POST /x")
	if out != idemFresh {
		t.Fatalf("first begin: %v", out)
	}
	if _, out = st.begin("d", "k", "POST /x"); out != idemInFlight {
		t.Errorf("second begin while running: %v", out)
	}
	st.finish("d", "k", e, 200, "application/json", []byte("{}"))
	if _, out = st.begin("d", "k", "POST /x"); out != idemReplay {
		t.Errorf("after finish: %v", out)
	}
}

func TestIdempotency_EntriesExpire(t *testing.T) {
	t.Parallel()
	st := newIdemStore(40 * time.Millisecond)
	e, _ := st.begin("d", "k", "POST /x")
	st.finish("d", "k", e, 200, "application/json", []byte("{}"))
	time.Sleep(120 * time.Millisecond)
	if _, out := st.begin("d", "k", "POST /x"); out != idemFresh {
		t.Errorf("an expired key must run again: %v", out)
	}
}

func TestIdempotency_ConcurrentSameKeyRunsOnce(t *testing.T) {
	t.Parallel()
	s, store, _ := newTestServer(t)
	writer := s.cfg.Writer.(*fakeWriter)
	cookie := store.addDeviceWith(t, "dev1", true, false)
	var wg sync.WaitGroup
	codes := make([]int, 6)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i] = postJSON(s, "/api/ade/backlog/move", cookie, idemA, `{"id":"b1","toIndex":1}`).Code
		}()
	}
	wg.Wait()
	if writer.count() != 1 {
		t.Errorf("6 concurrent same-key writes ran %d times", writer.count())
	}
	for _, c := range codes {
		if c != 200 && c != http.StatusConflict {
			t.Errorf("unexpected status %d", c)
		}
	}
}
