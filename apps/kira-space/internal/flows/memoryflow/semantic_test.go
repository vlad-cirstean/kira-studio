package memoryflow_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/embed"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// fakeHF serves model files like the Hugging Face host. A file with a gate streams half its bytes,
// flushes, and sends the rest once the test closes the gate.
type fakeHF struct {
	*httptest.Server
	mu    sync.Mutex
	files map[string][]byte
	gates map[string]chan struct{}
}

func newFakeHF(t *testing.T) *fakeHF {
	t.Helper()
	f := &fakeHF{files: map[string][]byte{}, gates: map[string]chan struct{}{}}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		data, ok := f.files[r.URL.Path]
		gate := f.gates[r.URL.Path]
		f.mu.Unlock()
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		half := len(data)
		if gate != nil {
			half /= 2
		}
		_, _ = w.Write(data[:half])
		if gate == nil {
			return
		}
		w.(http.Flusher).Flush()
		select {
		case <-gate:
			_, _ = w.Write(data[half:])
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(f.Close)
	return f
}

// serve registers a file at path and returns the embed.File pinned to it.
func (f *fakeHF) serve(name, path string, data []byte, gated bool) (embed.File, chan struct{}) {
	sum := sha256.Sum256(data)
	var gate chan struct{}
	f.mu.Lock()
	f.files[path] = data
	if gated {
		gate = make(chan struct{})
		f.gates[path] = gate
	}
	f.mu.Unlock()
	return embed.File{
		Name: name, URL: embed.HFBaseURL + path, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(data)),
	}, gate
}

func bytesOf(n int, b byte) []byte { return []byte(strings.Repeat(string(b), n)) }

// testSpec keeps the real model id (the status contract reads it) with small files from f.
func (f *fakeHF) testSpec(gated bool) (embed.Spec, [2]chan struct{}) {
	model, g1 := f.serve(embed.ModelFile, "/test/model.bin", bytesOf(4096, 'm'), gated)
	tok, g2 := f.serve(embed.TokenizerFile, "/test/tokenizer.json", bytesOf(2048, 't'), gated)
	spec := embed.Default
	spec.Files = []embed.File{model, tok}
	return spec.WithBaseURL(f.URL), [2]chan struct{}{g1, g2}
}

func TestInstallSemanticModel(t *testing.T) {
	t.Setenv("KIRA_ORT_LIB", "")
	fake := newFakeHF(t)
	spec, gates := fake.testSpec(true)
	app := flowharness.New(t, flowharness.WithEmbedSpec(spec))

	done := make(chan error, 1)
	go func() { done <- app.W.Memory.InstallSemanticModel(ctx) }()

	progress := func() memory.SemanticStatus {
		t.Helper()
		var st memory.SemanticStatus
		testx.WaitUntil(t, waitFor, func() bool {
			var err error
			if st, err = app.W.Memory.SemanticStatus(ctx); err != nil {
				t.Fatal(err)
			}
			return st.State == memory.SemanticDownloading && st.Done > 0
		})
		return st
	}
	first := progress()
	if first.Total != spec.TotalSize() || first.Done >= first.Total {
		t.Fatalf("mid first file: %+v, want done below total %d", first, spec.TotalSize())
	}
	app.Contract(t, "memory-settings", "MemoryService.SemanticStatus#downloading", first, flowharness.Mask("done"))

	close(gates[0])
	var second memory.SemanticStatus
	testx.WaitUntil(t, waitFor, func() bool {
		st, err := app.W.Memory.SemanticStatus(ctx)
		if err != nil {
			t.Fatal(err)
		}
		second = st
		return st.State == memory.SemanticDownloading && st.Done > first.Done
	})
	if second.Done >= second.Total {
		t.Fatalf("mid second file: %+v, want done below total", second)
	}
	close(gates[1])
	if err := <-done; err != nil {
		t.Fatalf("InstallSemanticModel: %v", err)
	}

	dir := filepath.Join(app.MemoryHome, "models", spec.ID)
	if !embed.Installed(dir, spec) {
		t.Fatalf("model dir %s is not a complete install", dir)
	}
	for _, f := range spec.Files {
		got, err := os.ReadFile(filepath.Join(dir, f.Name))
		if err != nil || int64(len(got)) != f.Size {
			t.Fatalf("%s = %d bytes, %v, want %d", f.Name, len(got), err, f.Size)
		}
	}
	st, err := app.W.Memory.SemanticStatus(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if st.State == memory.SemanticDownloading || st.State == memory.SemanticNotInstalled {
		t.Fatalf("status after install = %+v, want an installed state", st)
	}
	app.Contract(t, "memory-settings", "MemoryService.SemanticStatus#installed", st)
}

func TestInstallSemanticModelChecksum(t *testing.T) {
	t.Setenv("KIRA_ORT_LIB", "")
	fake := newFakeHF(t)
	spec := embed.Default.WithBaseURL(fake.URL)
	for _, f := range embed.Default.Files {
		fake.mu.Lock()
		fake.files[strings.TrimPrefix(f.URL, embed.HFBaseURL)] = bytesOf(int(f.Size), 'x')
		fake.mu.Unlock()
	}
	app := flowharness.New(t, flowharness.WithEmbedSpec(spec))

	err := app.W.Memory.InstallSemanticModel(ctx)
	var ie *ipcerr.Error
	if !errors.As(err, &ie) || !strings.Contains(ie.Message, "checksum") {
		t.Fatalf("InstallSemanticModel = %v, want the checksum error", err)
	}
	app.Contract(t, "memory-settings", "MemoryService.InstallSemanticModel#checksum", map[string]any{"code": ie.Code, "message": ie.Message})

	left, _ := filepath.Glob(filepath.Join(app.MemoryHome, "models", spec.ID, "*"))
	if len(left) != 0 {
		t.Fatalf("failed install left %v", left)
	}
	st, err := app.W.Memory.SemanticStatus(ctx)
	if err != nil || st.State != memory.SemanticNotInstalled {
		t.Fatalf("status = %+v, %v, want notInstalled", st, err)
	}
}

// A cancelled context stands in for an unreachable network.
func TestInstallSemanticModelCancelled(t *testing.T) {
	fake := newFakeHF(t)
	spec, _ := fake.testSpec(false)
	app := flowharness.New(t, flowharness.WithEmbedSpec(spec))
	cctx, cancel := context.WithCancel(context.Background())
	cancel()
	for i := range 2 {
		if err := app.W.Memory.InstallSemanticModel(cctx); err == nil {
			t.Fatalf("attempt %d: cancelled install succeeded", i)
		}
		st, err := app.W.Memory.SemanticStatus(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if st.State == memory.SemanticDownloading || st.Done != 0 {
			t.Fatalf("attempt %d: failed install left download state: %+v", i, st)
		}
		if i == 1 {
			app.Contract(t, "memory-settings", "MemoryService.SemanticStatus#cancelled", st)
		}
	}
	if m, _ := filepath.Glob(filepath.Join(app.MemoryHome, "models", "*", "installed.json")); len(m) != 0 {
		t.Fatalf("cancelled install wrote a manifest: %v", m)
	}
}
