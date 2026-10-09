package terminal

import (
	"os"
	"path/filepath"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// OpenArgs is Open's own wire type (P128 §2.1) — both apps' bridge.TerminalService embed
// *BoundService, so this is the one arg shape Wails binds for Open in either app.
type OpenArgs struct {
	TerminalID string `json:"terminalId"`
	Cwd        string `json:"cwd"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
	WindowKey  string `json:"windowKey"`
	// Command, when non-empty, runs as `$SHELL -l -i -c Command` instead of a plain login shell
	// (P85 §2.1) — the initial command a Claude Code or custom-script launch seeds the tab with.
	Command string `json:"command"`
	// LaunchKind is P86 §4's own discriminator — one of LaunchKindShell/ClaudeCode/Script, never
	// inferred from Command (P85 OQ-3's "no heuristic" rule, carried forward). "" is accepted and
	// treated as LaunchKindShell, so an older caller keeps working.
	LaunchKind string `json:"launchKind"`
	// ScriptID, only with LaunchKindScript, makes the host load the stored script: its command and
	// resolved folder replace Cwd and Command, which are ignored.
	ScriptID string `json:"scriptId"`
	// ScriptLaunchToken, only with ScriptID, is the single-use token a confirmed run dialog got
	// from scriptRuns.Start: it carries the run's folder and environment.
	ScriptLaunchToken string `json:"scriptLaunchToken"`
}

// MaxLaunchTokenBytes bounds ScriptLaunchToken.
const MaxLaunchTokenBytes = 64

// ValidateOpen is both apps' own TerminalService.Open — identical up to whatever each app's own
// Open builds into OpenParams past this call (P107 I2-5). The cwd check is not a trust boundary and
// must not be read as one: the shell it starts is the user's own and can `cd` anywhere on its
// first line. It exists so a stale path fails with a clear E_INVALID instead of a confusing exec
// error.
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
	if !ValidLaunchKind(args.LaunchKind) {
		return ipcerr.New("E_INVALID", "launchKind must be shell, claude-code or script")
	}
	if args.ScriptLaunchToken != "" && (args.ScriptID == "" || len(args.ScriptLaunchToken) > MaxLaunchTokenBytes) {
		return ipcerr.New("E_INVALID", "scriptLaunchToken needs scriptId and at most 64 characters")
	}
	if args.ScriptID != "" {
		if args.LaunchKind != LaunchKindScript {
			return ipcerr.New("E_INVALID", "scriptId needs launchKind script")
		}
		return nil
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
	return nil
}
