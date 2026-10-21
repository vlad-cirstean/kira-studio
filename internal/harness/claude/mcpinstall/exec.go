package mcpinstall

import (
	"os"
	"os/exec"
)

func realLookPath(name string) (string, error)  { return exec.LookPath(name) }
func realStat(path string) (os.FileInfo, error) { return os.Stat(path) }
