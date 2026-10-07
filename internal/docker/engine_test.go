package docker

import (
	"context"
	"encoding/base64"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"

	"github.com/kirathecat/kira-studio/internal/terminal"
)

const testImage = "mirror.gcr.io/library/alpine:3.20"

type recorded struct {
	window, name string
	data         any
}

type recorder struct {
	mu     sync.Mutex
	events []recorded
}

func (r *recorder) add(window, name string, data any) {
	r.mu.Lock()
	r.events = append(r.events, recorded{window, name, data})
	r.mu.Unlock()
}

func (r *recorder) Emit(name string, data any)           { r.add("", name, data) }
func (r *recorder) EmitTo(window, name string, data any) { r.add(window, name, data) }
func (r *recorder) EmitFocused(name string, data any)    { r.add("", name, data) }

func (r *recorder) count(name string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, e := range r.events {
		if e.name == name {
			n++
		}
	}
	return n
}

// waitFor polls pred over the recorded events until it holds or the deadline passes.
func (r *recorder) waitFor(t *testing.T, what string, pred func(recorded) bool) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		for _, e := range r.events {
			if pred(e) {
				r.mu.Unlock()
				return
			}
		}
		r.mu.Unlock()
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// TestEngine runs against a real engine and skips when none answers.
func TestEngine(t *testing.T) {
	rec := &recorder{}
	m := NewManager(rec)
	t.Cleanup(m.shutdown)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	cli, _, err := m.client()
	if err != nil {
		t.Skipf("no docker engine: %v", err)
	}
	if _, err := cli.Ping(ctx, client.PingOptions{}); err != nil {
		t.Skipf("no docker engine: %v", err)
	}

	pull, err := cli.ImagePull(ctx, testImage, client.ImagePullOptions{})
	if err != nil {
		t.Skipf("cannot pull %s: %v", testImage, err)
	}
	if err := pull.Wait(ctx); err != nil {
		t.Skipf("cannot pull %s: %v", testImage, err)
	}

	created, err := cli.ContainerCreate(ctx, client.ContainerCreateOptions{
		Name:   "kira-p200-engine-test",
		Config: &container.Config{Image: testImage, Tty: false, Cmd: []string{"sh", "-c", "while true; do echo tick; sleep 1; done"}},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := created.ID
	t.Cleanup(func() {
		_, _ = cli.ContainerRemove(context.Background(), id, client.ContainerRemoveOptions{Force: true})
	})
	if _, err := cli.ContainerStart(ctx, id, client.ContainerStartOptions{}); err != nil {
		t.Fatalf("start: %v", err)
	}

	t.Run("status and list", func(t *testing.T) {
		st := m.status(ctx, true)
		if st.State != "ok" || st.Engine == nil || st.Engine.Version == "" {
			t.Fatalf("status = %+v", st)
		}
		list, err := m.containers(ctx, true)
		if err != nil {
			t.Fatal(err)
		}
		var found bool
		for _, c := range list {
			if c.ID == id {
				found = c.State == "running"
			}
		}
		if !found {
			t.Fatalf("running test container %s missing from list", id)
		}
	})

	state := func() string {
		list, _ := m.containers(ctx, true)
		for _, c := range list {
			if c.ID == id {
				return c.State
			}
		}
		return ""
	}

	t.Run("stop and start", func(t *testing.T) {
		if err := m.stop(ctx, id); err != nil {
			t.Fatal(err)
		}
		if s := state(); s != "exited" {
			t.Fatalf("after stop state = %q", s)
		}
		if err := m.start(ctx, id); err != nil {
			t.Fatal(err)
		}
		if s := state(); s != "running" {
			t.Fatalf("after start state = %q", s)
		}
	})

	t.Run("logs follow", func(t *testing.T) {
		if err := m.logsOpen(LogsOpenArgs{WindowKey: "w1", StreamID: "s1", ContainerID: id, Tail: 0, Follow: true}); err != nil {
			t.Fatal(err)
		}
		rec.waitFor(t, "a followed log line", func(e recorded) bool {
			ev, ok := e.data.(LogsEvent)
			if !ok || e.name != ChannelLogs || ev.StreamID != "s1" {
				return false
			}
			for _, l := range ev.Lines {
				if l.Text == "tick" {
					return true
				}
			}
			return false
		})
		m.logsClose("s1")
	})

	t.Run("exec echo", func(t *testing.T) {
		if _, err := m.execOpen(ExecOpenArgs{WindowKey: "w1", TerminalID: "t1", ContainerID: id, Cols: 80, Rows: 24}); err != nil {
			t.Fatal(err)
		}
		if err := m.execWrite("t1", base64.StdEncoding.EncodeToString([]byte("echo hi-from-exec\nexit\n"))); err != nil {
			t.Fatal(err)
		}
		var out strings.Builder
		rec.waitFor(t, "exec exit with code 0", func(e recorded) bool {
			ev, ok := e.data.(terminal.Event)
			if !ok || e.name != ChannelExec || ev.TerminalID != "t1" {
				return false
			}
			if ev.Data != "" {
				b, _ := base64.StdEncoding.DecodeString(ev.Data)
				out.Write(b)
			}
			return ev.Exited && ev.ExitCode != nil && *ev.ExitCode == 0
		})
		if !strings.Contains(out.String(), "hi-from-exec") {
			t.Fatalf("exec output = %q", out.String())
		}
	})

	t.Run("stats and closeWindow", func(t *testing.T) {
		m.stats.subscribe("w2", []string{id})
		rec.waitFor(t, "a stats sample with memLimit", func(e recorded) bool {
			ev, ok := e.data.(StatsEvent)
			if !ok || e.window != "w2" {
				return false
			}
			for _, s := range ev.Samples {
				if s.ID == id && s.MemLimit > 0 {
					return true
				}
			}
			return false
		})
		if err := m.logsOpen(LogsOpenArgs{WindowKey: "w2", StreamID: "s2", ContainerID: id, Tail: 0, Follow: true}); err != nil {
			t.Fatal(err)
		}
		if _, err := m.execOpen(ExecOpenArgs{WindowKey: "w2", TerminalID: "t2", ContainerID: id, Cols: 80, Rows: 24}); err != nil {
			t.Fatal(err)
		}

		m.closeWindow("w2")

		if m.execs.get("t2") != nil {
			t.Fatal("exec session survived closeWindow")
		}
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			m.logs.mu.Lock()
			open := len(m.logs.streams)
			m.logs.mu.Unlock()
			m.stats.mu.Lock()
			streams := len(m.stats.streams)
			m.stats.mu.Unlock()
			if open == 0 && streams == 0 {
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatal("log or stats streams survived closeWindow")
	})
}
