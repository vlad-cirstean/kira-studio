package claude

import (
	"github.com/kirathecat/kira-studio/internal/harness"
	"github.com/kirathecat/kira-studio/internal/harness/claude/hooks"
)

// StartHooks serves the listener the CLI's lifecycle hooks and statusline report into.
func (*Provider) StartHooks(o harness.HookOptions) (harness.HookListener, error) {
	srv, err := hooks.New(o)
	if err != nil {
		return nil, err
	}
	return srv, nil
}

// UsageWindows: the statusline and the stream both carry the 5-hour and weekly windows.
func (*Provider) UsageWindows() bool { return true }
