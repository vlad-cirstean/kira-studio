package adeflow

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
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

// Reader lists and resolves workflows. It reads the directory on every call, never creates it and
// never writes a workflow file.
type Reader struct {
	Dir   string
	Store Store
	Now   func() time.Time
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
	var last map[string]string
	for _, name := range names {
		entry := adewire.WorkflowEntry{FileName: name, Path: filepath.Join(r.Dir, name)}
		src, err := os.ReadFile(entry.Path)
		var wf adewire.Workflow
		var werr *adewire.WorkflowError
		if err != nil {
			werr = &adewire.WorkflowError{Message: "cannot read the file: " + err.Error()}
		} else {
			wf, werr = Parse(src)
			if werr == nil && wf.ID != strings.TrimSuffix(name, ".yaml") {
				werr = &adewire.WorkflowError{Message: "id must equal the file name without .yaml"}
			}
		}
		if werr == nil {
			entry.Workflow = &wf
			r.record(name, &wf)
		} else {
			entry.Error = werr
			if last == nil {
				if last, err = r.Store.LastValid(); err != nil {
					slog.Warn("ade workflows: read last valid", "err", err)
					last = map[string]string{}
				}
			}
			if js, ok := last[name]; ok {
				var prev adewire.Workflow
				if json.Unmarshal([]byte(js), &prev) == nil {
					entry.Workflow = &prev
				}
			}
		}
		if entry.Workflow != nil && usedBy != nil {
			entry.UsedBy = usedBy(entry.Workflow.ID)
		}
		out.Workflows = append(out.Workflows, entry)
	}
	return out
}

func (r *Reader) record(file string, wf *adewire.Workflow) {
	js, err := json.Marshal(wf)
	if err != nil {
		slog.Warn("ade workflows: encode", "file", file, "err", err)
		return
	}
	last, err := r.Store.LastValid()
	if err == nil && last[file] == string(js) {
		return
	}
	if err := r.Store.RecordLastValid(file, string(js), r.now().UnixMilli()); err != nil {
		slog.Warn("ade workflows: record last valid", "file", file, "err", err)
	}
}

// Get returns the effective workflow with the given id: the file's current version when valid,
// else the last valid one. ok is false when no file defines it.
func (r *Reader) Get(id string) (adewire.Workflow, bool) {
	for _, e := range r.List(nil).Workflows {
		if e.Workflow != nil && e.Workflow.ID == id {
			return *e.Workflow, true
		}
	}
	return adewire.Workflow{}, false
}
