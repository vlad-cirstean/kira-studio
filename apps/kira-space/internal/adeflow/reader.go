package adeflow

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
)

// Store persists the last valid workflow per file so a file broken on disk keeps its previous
// version in use across restarts.
type Store interface {
	LastValid() (map[string]string, error)
	RecordLastValid(file, workflowJSON string, now int64) error
}

// Dir is the workflows directory under the app home.
func Dir(home string) string { return filepath.Join(home, "workflows") }

// Reader lists and resolves workflows. It reads the directory on every call. Only the writer
// methods (writer.go) create the directory or write a workflow file.
type Reader struct {
	Dir   string
	Store Store
	Now   func() time.Time

	wmu sync.Mutex // serializes the writer methods
}

func (r *Reader) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

// List reads every *.yaml file, sorted by name. usedBy reports how many live tasks use a
// workflow id (nil = 0). A missing or empty directory is a valid empty list.
func (r *Reader) List(usedBy func(id string) int) adewire.WorkflowsResult {
	out := adewire.WorkflowsResult{Dir: r.Dir, Workflows: make([]adewire.WorkflowEntry, 0)}
	entries, err := os.ReadDir(r.Dir)
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Warn("ade workflows: read dir", "dir", r.Dir, "err", err)
		}
		return out
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.Type().IsRegular() && strings.HasSuffix(e.Name(), ".yaml") && !strings.HasPrefix(e.Name(), ".") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	lv := &lastValid{store: r.Store}
	for _, name := range names {
		entry := r.entryFor(name, lv)
		if entry.Workflow != nil && usedBy != nil {
			entry.UsedBy = usedBy(entry.Workflow.ID)
		}
		out.Workflows = append(out.Workflows, entry)
	}
	return out
}

// lastValid loads Store.LastValid once per read and keeps it current with the writes made through it.
type lastValid struct {
	store  Store
	loaded bool
	m      map[string]string
}

func (l *lastValid) get() map[string]string {
	if !l.loaded {
		l.loaded = true
		m, err := l.store.LastValid()
		if err != nil {
			slog.Warn("ade workflows: read last valid", "err", err)
			m = map[string]string{}
		}
		l.m = m
	}
	return l.m
}

// entryFor reads one workflow file: its parsed workflow, or its error plus the last valid version.
func (r *Reader) entryFor(name string, lv *lastValid) adewire.WorkflowEntry {
	entry := adewire.WorkflowEntry{FileName: name, Path: filepath.Join(r.Dir, name)}
	var wf adewire.Workflow
	var werr *adewire.WorkflowError
	src, err := readCapped(entry.Path)
	entry.Hash = textHash(src)
	switch {
	case err != nil:
		werr = &adewire.WorkflowError{Message: "cannot read the file: " + err.Error()}
	default:
		wf, werr = Parse(src)
		if werr == nil && wf.ID != strings.TrimSuffix(name, ".yaml") {
			werr = &adewire.WorkflowError{Message: "id must equal the file name without .yaml"}
		}
	}
	if werr == nil {
		entry.Workflow = &wf
		r.record(name, &wf, lv)
		return entry
	}
	entry.Error = werr
	if js, ok := lv.get()[name]; ok {
		var prev adewire.Workflow
		if json.Unmarshal([]byte(js), &prev) == nil {
			entry.Workflow = &prev
		}
	}
	return entry
}

var errTooLarge = errors.New("file is larger than 1 MiB")

// readCapped reads a workflow file, refusing one over maxYamlBytes (the cap app writes enforce).
func readCapped(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	src, err := io.ReadAll(io.LimitReader(f, maxYamlBytes+1))
	if err != nil {
		return nil, err
	}
	if len(src) > maxYamlBytes {
		return nil, errTooLarge
	}
	return src, nil
}

func (r *Reader) record(file string, wf *adewire.Workflow, lv *lastValid) {
	js, err := json.Marshal(wf)
	if err != nil {
		slog.Warn("ade workflows: encode", "file", file, "err", err)
		return
	}
	last := lv.get()
	if last[file] == string(js) {
		return
	}
	if err := r.Store.RecordLastValid(file, string(js), r.now().UnixMilli()); err != nil {
		slog.Warn("ade workflows: record last valid", "file", file, "err", err)
		return
	}
	last[file] = string(js)
}

// Get returns the effective workflow with the given id: the file's current version when valid,
// else the last valid one. ok is false when no file defines it. Only <id>.yaml is read: a workflow's
// id always equals its file name.
func (r *Reader) Get(id string) (adewire.Workflow, bool) {
	if id == "" || id != filepath.Base(id) || strings.HasPrefix(id, ".") {
		return adewire.Workflow{}, false
	}
	name := id + ".yaml"
	if _, err := os.Stat(filepath.Join(r.Dir, name)); err != nil {
		return adewire.Workflow{}, false
	}
	if e := r.entryFor(name, &lastValid{store: r.Store}); e.Workflow != nil && e.Workflow.ID == id {
		return *e.Workflow, true
	}
	return adewire.Workflow{}, false
}
