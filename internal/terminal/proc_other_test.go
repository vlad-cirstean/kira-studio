//go:build !linux

package terminal

import (
	"os/exec"
	"strconv"
	"strings"
)

// procState returns the ps state letter for pid and the raw ps output; "" when pid is gone.
func procState(pid int) (state, line string) {
	out, _ := exec.Command("ps", "-o", "stat=", "-p", strconv.Itoa(pid)).Output()
	line = strings.TrimSpace(string(out))
	if line == "" {
		return "", ""
	}
	return line[:1], line
}
