//go:build !linux

package terminal

import (
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// procInfo returns pid's command name, ps state letter and raw ps output; all empty when pid is gone.
func procInfo(pid int) (comm, state, line string) {
	out, _ := exec.Command("ps", "-o", "stat=,comm=", "-p", strconv.Itoa(pid)).Output()
	line = strings.TrimSpace(string(out))
	f := strings.Fields(line)
	if len(f) < 2 {
		return "", "", line
	}
	return filepath.Base(strings.Join(f[1:], " ")), f[0][:1], line
}
