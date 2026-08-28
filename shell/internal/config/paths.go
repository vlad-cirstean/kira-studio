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

// DbPath is the Go build's own database file — deliberately not kira.sqlite (P52 §5.1): a
// different filename lets the Electron and Go builds coexist on one machine without colliding,
// and post-cutover kira.sqlite is simply never read again.
func DbPath() string {
	return filepath.Join(KiraHome(), "kira.db")
}

func LogsDir() string {
	return filepath.Join(KiraHome(), "logs")
}

// EnsureLayout creates KIRA_HOME and its logs directory with the same permissions the Electron
// build uses (0700), tightening an existing loose directory too, not only on first create.
func EnsureLayout() error {
	for _, dir := range []string{KiraHome(), LogsDir()} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
		if err := os.Chmod(dir, 0o700); err != nil {
			return err
		}
	}
	return nil
}
