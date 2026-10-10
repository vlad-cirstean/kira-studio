package flowharness

import (
	"context"
	"os"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/localauth"
	"github.com/kirathecat/kira-studio/internal/mcpinstall"
)

// Browser records OpenURL calls.
type Browser struct {
	mu   sync.Mutex
	urls []string
}

func (b *Browser) OpenURL(url string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.urls = append(b.urls, url)
	return nil
}

// Opened returns a copy of the recorded URLs.
func (b *Browser) Opened() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string(nil), b.urls...)
}

// Dialogs answers the native pickers from queues; an empty queue answers like a cancel ("").
type Dialogs struct {
	mu      sync.Mutex
	saves   []string
	opens   []string
	folders []string
	// Save, Open and Folder record every request, in order.
	Save   []bridge.SaveFileRequest
	Open   []bridge.OpenFileRequest
	Folder []bridge.OpenDirectoryRequest
}

// QueueSaveFile queues the path the next SaveFile returns.
func (d *Dialogs) QueueSaveFile(path string) { d.push(&d.saves, path) }

// QueueOpenFile queues the path the next OpenFile returns.
func (d *Dialogs) QueueOpenFile(path string) { d.push(&d.opens, path) }

// QueueDirectory queues the path the next OpenDirectory returns.
func (d *Dialogs) QueueDirectory(path string) { d.push(&d.folders, path) }

func (d *Dialogs) push(q *[]string, path string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	*q = append(*q, path)
}

func pop(q *[]string) string {
	if len(*q) == 0 {
		return ""
	}
	p := (*q)[0]
	*q = (*q)[1:]
	return p
}

func (d *Dialogs) SaveFile(req bridge.SaveFileRequest) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Save = append(d.Save, req)
	return pop(&d.saves), nil
}

func (d *Dialogs) OpenFile(req bridge.OpenFileRequest) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Open = append(d.Open, req)
	return pop(&d.opens), nil
}

func (d *Dialogs) OpenDirectory(req bridge.OpenDirectoryRequest) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Folder = append(d.Folder, req)
	return pop(&d.folders), nil
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

// McpInstaller records installs; it never touches the real claude config.
type McpInstaller struct {
	mu       sync.Mutex
	Installs []McpInstall
}

// McpInstall is one Install call.
type McpInstall struct{ Name, URL, Token string }

func (m *McpInstaller) Status() mcpinstall.Status { return mcpinstall.Status{} }

func (m *McpInstaller) Install(_ context.Context, name, url, token string) mcpinstall.Result {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Installs = append(m.Installs, McpInstall{name, url, token})
	return mcpinstall.Result{}
}

// OSAuth scripts the OS authentication prompt. By default it is unavailable, so a reveal needs the
// in-app confirmation, as on a Mac with neither biometry nor a login password.
type OSAuth struct {
	mu        sync.Mutex
	available bool
	outcome   localauth.Outcome
	// Prompts records the reason of every evaluate call.
	Prompts []string
}

// Script sets whether OS authentication is available and what its prompt answers.
func (o *OSAuth) Script(available bool, outcome localauth.Outcome) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.available, o.outcome = available, outcome
}

func (o *OSAuth) evaluate(reason string) (localauth.Outcome, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.Prompts = append(o.Prompts, reason)
	return o.outcome, nil
}

func (o *OSAuth) isAvailable() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.available
}

func mkdirs(paths ...string) error {
	for _, p := range paths {
		if err := os.MkdirAll(p, 0o755); err != nil {
			return err
		}
	}
	return nil
}
