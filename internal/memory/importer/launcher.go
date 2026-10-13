package importer

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// Launcher starts an import runner. The runner takes the store's lock itself and exits when another
// holds it, so a launch that loses a race is harmless.
type Launcher interface {
	Launch() error
}

const maxRunnerLogBytes = 1 << 20

// SpawnLauncher starts `<Executable> memory-ingest` as a detached process: own session, no stdin or
// stdout, stderr appended to LogPath. The runner outlives the process that launched it.
type SpawnLauncher struct {
	Executable string
	LogPath    string
}

func (l SpawnLauncher) Launch() error {
	cmd := exec.Command(l.Executable, "memory-ingest")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Env = os.Environ()
	if l.LogPath != "" {
		log, err := openRunnerLog(l.LogPath)
		if err != nil {
			return err
		}
		defer log.Close()
		cmd.Stderr = log
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	// Reap the child if it ends while this process still runs.
	go func() { _ = cmd.Wait() }()
	return nil
}

// openRunnerLog opens the runner log for append, starting it over once it passes 1 MiB.
func openRunnerLog(path string) (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("import runner log: %w", err)
	}
	flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	if info, err := os.Stat(path); err == nil && info.Size() > maxRunnerLogBytes {
		flags = os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	}
	f, err := os.OpenFile(path, flags, 0o600)
	if err != nil {
		return nil, fmt.Errorf("import runner log: %w", err)
	}
	return f, nil
}
