//go:build linux

package terminal

import (
	"os"
	"strconv"
	"strings"
)

// procInfo returns pid's command name, /proc state letter and raw stat line; all empty when pid is gone.
func procInfo(pid int) (comm, state, line string) {
	b, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return "", "", ""
	}
	line = strings.TrimSpace(string(b))
	// comm may hold spaces and parens, so it spans first '(' to last ')' and the state follows.
	open, end := strings.IndexByte(line, '('), strings.LastIndexByte(line, ')')
	if open < 0 || end < open || end+2 >= len(line) {
		return "", "", line
	}
	return line[open+1 : end], line[end+2 : end+3], line
}
