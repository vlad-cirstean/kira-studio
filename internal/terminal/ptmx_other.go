//go:build !linux

package terminal

import (
	"os"

	"github.com/creack/pty"
)

// pollablePtmx is the identity off Linux: kqueue pollability of a pty master is unverified on
// darwin, so the creack/pty default (blocking fd) stays.
func pollablePtmx(ptmx *os.File) (*os.File, error) { return ptmx, nil }

func setWinsize(ptmx *os.File, ws *pty.Winsize) error { return pty.Setsize(ptmx, ws) }
