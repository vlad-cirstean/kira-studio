package flowharness

import (
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/internal/shell"
)

// Browser records OpenURL calls.
type Browser struct {
	mu   sync.Mutex
	URLs []string
	Err  error
}

func (b *Browser) OpenURL(url string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.URLs = append(b.URLs, url)
	return b.Err
}

// Opened returns a copy of the recorded URLs.
func (b *Browser) Opened() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string(nil), b.URLs...)
}

// Dialogs answers the native pickers from queues; an empty queue answers like a cancel.
type Dialogs struct {
	mu          sync.Mutex
	directories []string
	files       [][]string
	// Requests records every call, in order.
	Directory []bridge.OpenDirectoryRequest
	Files     []bridge.OpenFilesRequest
}

// AnswerDirectory queues the path the next OpenDirectory returns.
func (d *Dialogs) AnswerDirectory(path string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.directories = append(d.directories, path)
}

// AnswerFiles queues the paths the next OpenFiles returns.
func (d *Dialogs) AnswerFiles(paths ...string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.files = append(d.files, paths)
}

func (d *Dialogs) OpenDirectory(req bridge.OpenDirectoryRequest) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Directory = append(d.Directory, req)
	if len(d.directories) == 0 {
		return "", nil
	}
	p := d.directories[0]
	d.directories = d.directories[1:]
	return p, nil
}

func (d *Dialogs) OpenFiles(req bridge.OpenFilesRequest) ([]string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Files = append(d.Files, req)
	if len(d.files) == 0 {
		return nil, nil
	}
	p := d.files[0]
	d.files = d.files[1:]
	return p, nil
}

// WindowManager records the window-manager calls the app makes.
type WindowManager struct {
	mu         sync.Mutex
	Opened     []shell.WindowRecord
	Closed     []string
	Focused    []string
	Titles     map[string]string
	NewWindows int
	// Known is the set of window keys Close and Focus report true for.
	Known map[string]bool
}

func newWindowManager() *WindowManager {
	return &WindowManager{Titles: map[string]string{}, Known: map[string]bool{}}
}

func (w *WindowManager) OpenWindow(rec shell.WindowRecord) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.Opened = append(w.Opened, rec)
	w.Known[rec.Key] = true
}

func (w *WindowManager) CloseWindow(key string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.Closed = append(w.Closed, key)
	known := w.Known[key]
	delete(w.Known, key)
	return known
}

func (w *WindowManager) FocusWindow(key string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.Focused = append(w.Focused, key)
	return w.Known[key]
}

func (w *WindowManager) SetWindowTitle(key, title string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.Titles[key] = title
}

// openNew counts OpenNewWindow invocations into NewWindows.
func (w *WindowManager) openNew() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.NewWindows++
}

// KeepAwakeDriver records the power assertion instead of holding one.
type KeepAwakeDriver struct {
	mu       sync.Mutex
	held     bool
	Acquires int
	Releases int
}

func (k *KeepAwakeDriver) Acquire() error {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.held = true
	k.Acquires++
	return nil
}

func (k *KeepAwakeDriver) Release() {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.held = false
	k.Releases++
}

func (k *KeepAwakeDriver) Supported() bool { return true }

// Held reports whether an assertion is currently held.
func (k *KeepAwakeDriver) Held() bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.held
}
