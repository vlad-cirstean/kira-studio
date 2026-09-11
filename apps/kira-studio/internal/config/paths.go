// Package config resolves the app's on-disk locations and dev/packaged mode.
// Go analogue of src/main/storage/paths.ts and src/main/env.ts.
package config

import (
	"os"
	"path/filepath"
)

// KiraHome is the app's data directory, honouring KIRA_HOME identically to the Electron build.
func KiraHome() string {
	if home := os.Getenv("KIRA_HOME"); home != "" {
		return home
	}
	dir, err := os.UserHomeDir()
	if err != nil {
		// os.UserHomeDir only fails when neither $HOME nor the platform's user-registry lookup
		// resolves — treat it the same as "no home", which every process on this machine hits.
		dir = "."
	}
	return filepath.Join(dir, ".kira-studio")
}

// DbPath is the Go build's own database file, named kira.db. Originally chosen (P52 §5.1) so the
// since-removed Electron build's kira.sqlite could coexist on one machine without colliding —
// there has been no Electron build since P57, so that reason is gone, but there is also no
// installed base still on the old name to migrate, so the file stays kira.db rather than being
// renamed for its own sake (P21 round 1 architecture/security finding 9). docs/ARCHITECTURE.md
// names this file kira.db throughout; if you find it saying kira.sqlite anywhere, that is the doc
// drifting, not this file.
func DbPath() string {
	return DbPathAt(KiraHome())
}

// DbPathAt is DbPath against an explicit home dir instead of KiraHome()'s env lookup — lets a
// caller (storage.OpenAt) resolve a path without going through $KIRA_HOME, so a test can run
// t.Parallel() without t.Setenv's parallel-test panic (v1.4 P1).
func DbPathAt(home string) string {
	return filepath.Join(home, "kira.db")
}

func LogsDir() string {
	return LogsDirAt(KiraHome())
}

// LogsDirAt is LogsDir against an explicit home dir — see DbPathAt.
func LogsDirAt(home string) string {
	return filepath.Join(home, "logs")
}

// EnsureLayout creates KIRA_HOME and its logs directory with the same permissions the Electron
// build uses (0700), tightening an existing loose directory too, not only on first create.
func EnsureLayout() error {
	return EnsureLayoutAt(KiraHome())
}

// EnsureLayoutAt is EnsureLayout against an explicit home dir — see DbPathAt.
func EnsureLayoutAt(home string) error {
	for _, dir := range []string{home, LogsDirAt(home)} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
		if err := os.Chmod(dir, 0o700); err != nil {
			return err
		}
	}
	return nil
}
