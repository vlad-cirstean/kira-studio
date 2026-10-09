package claudecfg

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/internal/mcpinstall"
)

// Cleanup outcomes.
const (
	OutcomeRemoved  = "removed"
	OutcomeNothing  = "nothing"
	OutcomeNotFound = "notFound"
	OutcomeFailed   = "failed"
)

// Remover is the claude CLI seam: mcpinstall.Installer.
type Remover interface {
	Status() mcpinstall.Status
	Remove(ctx context.Context, name string) mcpinstall.Result
}

// CleanupResult is what a cleanup did. Commands lists the exact removals to run by hand when the
// CLI is missing.
type CleanupResult struct {
	Outcome    string   `json:"outcome"`
	Removed    []string `json:"removed"`
	Remaining  []string `json:"remaining"`
	BackupPath string   `json:"backupPath"`
	Detail     string   `json:"detail"`
	Commands   []string `json:"commands"`
}

var cleanupMu sync.Mutex

// CleanupLegacy removes the named Kira-written entries from the config file at path through
// `claude mcp remove --scope user`, which owns the file's format. Only names that still match a
// Kira entry are touched. The whole file is copied to backupDir first. Without the CLI nothing is
// edited and no backup is made.
func CleanupLegacy(ctx context.Context, r Remover, path, backupDir string, names []string) CleanupResult {
	cleanupMu.Lock()
	defer cleanupMu.Unlock()
	res := CleanupResult{Removed: []string{}, Remaining: []string{}, Commands: []string{}}

	found, err := DetectLegacy(path)
	if err != nil {
		res.Outcome, res.Detail = OutcomeFailed, err.Error()
		return res
	}
	var todo []string
	for _, n := range found.Names() {
		if slices.Contains(names, n) {
			todo = append(todo, n)
		}
	}
	if len(todo) == 0 {
		res.Outcome = OutcomeNothing
		return res
	}
	if r.Status().ClaudePath == "" {
		res.Outcome = OutcomeNotFound
		for _, n := range todo {
			res.Commands = append(res.Commands, "claude mcp remove --scope user "+mcpinstall.ShellQuote(n))
		}
		return res
	}

	backup, err := backupFile(path, backupDir)
	if err != nil {
		res.Outcome, res.Detail = OutcomeFailed, "backup: "+err.Error()
		return res
	}
	res.BackupPath = backup

	for _, n := range todo {
		if rr := r.Remove(ctx, n); rr.Outcome != mcpinstall.OutcomeRemoved && res.Detail == "" {
			res.Detail = rr.Detail
		}
	}
	after, err := DetectLegacy(path)
	if err != nil {
		res.Outcome, res.Detail = OutcomeFailed, err.Error()
		return res
	}
	for _, n := range todo {
		if slices.Contains(after.Names(), n) {
			res.Remaining = append(res.Remaining, n)
		} else {
			res.Removed = append(res.Removed, n)
		}
	}
	if len(res.Remaining) == 0 {
		res.Outcome, res.Detail = OutcomeRemoved, ""
	} else {
		res.Outcome = OutcomeFailed
	}
	return res
}

// backupFile copies src byte for byte to dir/claude.json.<UTC timestamp> (dir 0700, file 0600).
func backupFile(src, dir string) (string, error) {
	raw, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	stamp := "claude.json." + time.Now().UTC().Format("20060102T150405Z")
	for n := 0; ; n++ {
		dst := filepath.Join(dir, stamp)
		if n > 0 {
			dst += "-" + strconv.Itoa(n)
		}
		f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		_, werr := f.Write(raw)
		if cerr := f.Close(); werr == nil {
			werr = cerr
		}
		return dst, werr
	}
}
