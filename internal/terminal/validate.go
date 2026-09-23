package terminal

import (
	"os"
	"path/filepath"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// OpenArgs is the subset of each app's own bound TerminalOpenArgs that Open's validation chain
// reads — the bound struct itself stays per app (P103 §2.3); each bridge converts to this before
// calling ValidateOpen (P107 I2-5).
type OpenArgs struct {
	TerminalID string
	WindowKey  string
	Cwd        string
	Cols       int
	Rows       int
	Command    string
	LaunchKind string
}

// ValidateOpen is both apps' own TerminalService.Open — identical up to the AgentHooks
// composition that follows it in Kira Studio only, which stays in that bridge (P107 I2-5). The
// cwd check is not a trust boundary and must not be read as one: the shell it starts is the
// user's own and can `cd` anywhere on its first line. It exists so a stale path fails with a
// clear E_INVALID instead of a confusing exec error.
func ValidateOpen(args OpenArgs) error {
	if args.TerminalID == "" {
		return ipcerr.New("E_INVALID", "terminalId is required")
	}
	if args.WindowKey == "" {
		return ipcerr.BadRequest("windowKey is required")
	}
	if !ValidDim(args.Cols) || !ValidDim(args.Rows) {
		return ipcerr.New("E_INVALID", "cols/rows must be within [1, 1000]")
	}
	if !filepath.IsAbs(args.Cwd) {
		return ipcerr.New("E_INVALID", "cwd must be an absolute path")
	}
	info, err := os.Stat(args.Cwd)
	if err != nil || !info.IsDir() {
		return ipcerr.New("E_INVALID", "cwd does not exist or is not a directory")
	}
	if len(args.Command) > MaxCommandBytes {
		return ipcerr.New("E_INVALID", "command is too long")
	}
	if !ValidLaunchKind(args.LaunchKind) {
		return ipcerr.New("E_INVALID", "launchKind must be shell, claude-code or script")
	}
	return nil
}
