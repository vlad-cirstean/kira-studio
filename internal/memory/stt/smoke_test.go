//go:build whisper && sttsmoke

package stt

import (
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/memory/modelstore"
)

// Real-model check, not in CI: needs the whisper.cpp libs (scripts/fetch-whisper.sh linux-x64),
// network for the model download, and the jfk.wav sample from that source tree. Run with
// CGO_CFLAGS/CGO_LDFLAGS from fetch-whisper.sh:
//
//	go test -tags whisper,sttsmoke ./internal/memory/stt/ -run Smoke -v

func init() {
	if dir := os.Getenv("KIRA_STT_SMOKE_WORKER"); dir != "" {
		os.Exit(RunWorker([]string{"--model-dir", dir}))
	}
}

const rssCeilingKB = 400 * 1024

func readWAV(t *testing.T, path string) []int16 {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("sample not found: %v", err)
	}
	for i := 12; i+8 <= len(b); {
		size := int(binary.LittleEndian.Uint32(b[i+4:]))
		if string(b[i:i+4]) == "data" {
			raw := b[i+8 : min(i+8+size, len(b))]
			out := make([]int16, len(raw)/2)
			for j := range out {
				out[j] = int16(binary.LittleEndian.Uint16(raw[2*j:]))
			}
			return out
		}
		i += 8 + size
	}
	t.Fatal("no data chunk in wav")
	return nil
}

func vmHWM(t *testing.T, pid int) int {
	t.Helper()
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`VmHWM:\s+(\d+) kB`).FindSubmatch(b)
	if m == nil {
		t.Fatal("no VmHWM")
	}
	kb, _ := strconv.Atoi(string(m[1]))
	return kb
}

func TestSmokeRealModel(t *testing.T) {
	wav := os.Getenv("KIRA_STT_SMOKE_WAV")
	if wav == "" {
		wav = filepath.Join("..", "..", "..", "apps", "kira-space", "build", "whisper", "src", "samples", "jfk.wav")
	}
	pcm := readWAV(t, wav)

	home := t.TempDir()
	dir := ModelDir(home, Default)
	var last int64
	if err := modelstore.Install(context.Background(), dir, Default.ID, Default.Files, func(done, total int64) { last = done }); err != nil {
		t.Fatal(err)
	}
	if last != Default.TotalSize() || !Installed(dir, Default) {
		t.Fatalf("install incomplete: %d of %d bytes", last, Default.TotalSize())
	}

	var started atomic.Pointer[exec.Cmd]
	c := NewClient(ClientOptions{Spec: Default, Home: home, IdleTimeout: 2 * time.Second, Command: func(d string) *exec.Cmd {
		cmd := exec.Command(os.Args[0], "-test.run=^$")
		cmd.Env = append(os.Environ(), "KIRA_STT_SMOKE_WORKER="+d)
		started.Store(cmd)
		return cmd
	}})
	defer c.Close()

	var mu sync.Mutex
	var frames []Frame
	mic := func(onPCM func([]int16)) (func(), error) {
		stop := make(chan struct{})
		done := make(chan struct{})
		go func() {
			defer close(done)
			for i := 0; i < len(pcm); i += chunkFrames {
				select {
				case <-stop:
					return
				case <-time.After(25 * time.Millisecond): // 4x real time
				}
				onPCM(pcm[i:min(i+chunkFrames, len(pcm))])
			}
		}()
		return func() { close(stop); <-done }, nil
	}
	d, err := c.Dictate(context.Background(), DictateOptions{Mic: mic, Emit: func(f Frame) {
		mu.Lock()
		frames = append(frames, f)
		mu.Unlock()
	}})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Duration(len(pcm)/captureRate)*time.Second/4 + 2*time.Second)
	d.Stop()
	select {
	case <-d.Done():
	case <-time.After(60 * time.Second):
		t.Fatal("session did not finish")
	}

	cmd := started.Load()
	if cmd == nil || cmd.Process == nil {
		t.Fatal("worker was not started")
	}
	pid := cmd.Process.Pid
	kb := vmHWM(t, pid)

	mu.Lock()
	defer mu.Unlock()
	var final string
	texts := 0
	for _, f := range frames {
		switch f.Type {
		case "text":
			texts++
		case "final":
			final = f.Text
		case "error":
			t.Fatalf("error frame: %+v", f)
		}
	}
	norm := strings.ToLower(regexp.MustCompile(`[^a-zA-Z ]`).ReplaceAllString(final, ""))
	t.Logf("final: %q (%d live text frames)", final, texts)
	if !strings.Contains(norm, "ask not what your country can do for you") {
		t.Errorf("final text %q misses the quote", final)
	}
	if texts == 0 {
		t.Error("no live text frames")
	}
	t.Logf("worker VmHWM: %d MB", kb/1024)
	if kb > rssCeilingKB {
		t.Errorf("worker peak RSS %d MB exceeds 400 MB", kb/1024)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(fmt.Sprintf("/proc/%d", pid)); os.IsNotExist(err) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Error("worker still alive after the idle timeout")
}
