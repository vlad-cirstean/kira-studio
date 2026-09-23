package gitvsix

import (
	"os"
	"os/exec"
)

// realExecutable/realLookPath/realStat are Deps' zero-value fallbacks — os.Executable/
// exec.LookPath/os.Stat, unwrapped, so a caller providing no Deps at all gets the real OS.
func realExecutable() (string, error)           { return os.Executable() }
func realLookPath(name string) (string, error)  { return exec.LookPath(name) }
func realStat(path string) (os.FileInfo, error) { return os.Stat(path) }
