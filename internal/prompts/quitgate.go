package prompts

import (
	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
)

const quitRef = "app"

// QuitGate is a shell.QuitGate that raises the quit confirmation through the router: Live counts
// the work a quit would stop.
type QuitGate struct {
	R      *Router
	LiveFn func() int
}

// Live is the count of work a quit would stop.
func (g QuitGate) Live() int { return g.LiveFn() }

// Ask opens the quit popup and reveals it, reopening a window when none is open.
func (g QuitGate) Ask(int) {
	g.R.Open(Prompt{ID: ID(KindQuit, quitRef), Kind: KindQuit, Ref: quitRef,
		Title: i18n.T("backend.prompt.quit.title", map[string]string{"app": g.R.App()})})
	g.R.RevealKind(KindQuit)
}

// Withdraw drops the quit popup.
func (g QuitGate) Withdraw() { g.R.Close(ID(KindQuit, quitRef)) }
