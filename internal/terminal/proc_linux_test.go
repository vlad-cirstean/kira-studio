//go:build linux

package terminal

import (
	"os"
	"strconv"
	"strings"
)

// procState returns the /proc state letter for pid and the raw stat line; "" when pid is gone.
func procState(pid int) (state, line string) {
	b, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return "", ""
	}
	line = strings.TrimSpace(string(b))
	// comm may hold spaces and parens, so the state is the first field after the last ')'.
	i := strings.LastIndexByte(line, ')')
	if i < 0 || i+2 >= len(line) {
		return "", line
	}
	return line[i+2 : i+3], line
}
