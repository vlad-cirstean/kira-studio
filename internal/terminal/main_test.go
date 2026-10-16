package terminal

import (
	"os"
	"testing"

	"github.com/kirathecat/kira-studio/internal/testx"
)

// Interactive bash in a pty writes $HOME/.bash_history; keep it off the real home.
func TestMain(m *testing.M) { os.Exit(testx.RunWithTempUserHome(m)) }
