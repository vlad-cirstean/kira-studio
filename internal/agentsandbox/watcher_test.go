package agentsandbox

import (
	"context"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const denyJSON = `{"eventMessage":"Sandbox: cat(42) deny(1) file-read-data /Users/x/secret"}` + "\n"

func TestAttributeVanishedProcess(t *testing.T) {
	w := newWatcher(newHub())
	w.ppid = func(pid int) (int, bool) { return 0, false }
	w.roots["run-1"] = 10
	if _, ok := w.attribute(42, "cat"); ok {
		t.Fatal("vanished unknown process attributed to the only run")
	}
	w.names["run-1"] = map[string]bool{"cat": true}
	if run, ok := w.attribute(42, "cat"); !ok || run != "run-1" {
		t.Fatalf("vanished known process: %q %v", run, ok)
	}
	if _, ok := w.attribute(43, "Safari"); ok {
		t.Fatal("other app's process attributed")
	}
}

func TestLoopRestartsAfterGiveUp(t *testing.T) {
	w := newWatcher(newHub())
	w.backoffs = []time.Duration{time.Millisecond}
	var starts atomic.Int32
	w.start = func(context.Context) (io.ReadCloser, func() error, error) {
		starts.Add(1)
		return io.NopCloser(strings.NewReader("")), func() error { return nil }, nil
	}
	w.watch(1, "run-1")
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		w.mu.Lock()
		gone := w.cancel == nil
		w.mu.Unlock()
		if gone {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	w.mu.Lock()
	gone := w.cancel == nil
	w.mu.Unlock()
	if !gone {
		t.Fatal("cancel not cleared after give-up")
	}
	before := starts.Load()
	w.watch(2, "run-2")
	deadline = time.Now().Add(5 * time.Second)
	for starts.Load() == before && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if starts.Load() == before {
		t.Fatal("next watch did not restart the loop")
	}
}

func TestLoopResetsFailuresAfterHealthyStream(t *testing.T) {
	w := newWatcher(newHub())
	w.backoffs = []time.Duration{time.Millisecond, time.Millisecond}
	var starts atomic.Int32
	w.start = func(context.Context) (io.ReadCloser, func() error, error) {
		n := starts.Add(1)
		body := ""
		if n%2 == 1 { // every other stream delivers a line before it exits
			body = denyJSON
		}
		return io.NopCloser(strings.NewReader(body)), func() error { return nil }, nil
	}
	w.watch(1, "run-1")
	deadline := time.Now().Add(5 * time.Second)
	for starts.Load() < 8 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if starts.Load() < 8 {
		t.Fatalf("loop gave up after %d starts despite healthy streams", starts.Load())
	}
	w.mu.Lock()
	w.cancel()
	w.mu.Unlock()
}
