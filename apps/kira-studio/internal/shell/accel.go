package shell

import "strings"

// Chord is the Go port of src/shared/domain/shortcuts.ts's chord shape, for the 13 `global: true`
// bindings menu.ts consumes. Only the modifier vocabulary differs: Wails' parseAccelerator
// (keys.go:182-217) accepts "Ctrl", never "Control", and SetAccelerator silently drops an
// accelerator it cannot parse (menuitem.go:275-287) — so a verbatim port would leave Next/Previous
// Tab with no accelerator at all (P56 §1.4).
type Chord struct {
	Key       string // "N", "Return", "Tab", "F5", ","
	CmdOrCtrl bool
	Ctrl      bool
	Shift     bool
	Alt       bool
}

// Accelerator renders c as a Wails accelerator string ("CmdOrCtrl+Shift+P", "Ctrl+Tab", "F5").
func (c Chord) Accelerator() string {
	var parts []string
	if c.CmdOrCtrl {
		parts = append(parts, "CmdOrCtrl")
	}
	if c.Ctrl {
		parts = append(parts, "Ctrl")
	}
	if c.Alt {
		parts = append(parts, "Alt")
	}
	if c.Shift {
		parts = append(parts, "Shift")
	}
	parts = append(parts, c.Key)
	return strings.Join(parts, "+")
}

// Shortcuts mirrors SHORTCUTS' `global: true` rows by id (src/shared/domain/shortcuts.ts:25-37),
// so the table can be diffed against the TS by name.
var Shortcuts = map[string]Chord{
	"app.settings":               {Key: ",", CmdOrCtrl: true},
	"app.newConnection":          {Key: "N", CmdOrCtrl: true},
	"view.toggleProjectPanel":    {Key: "B", CmdOrCtrl: true},
	"view.toggleOperationsPanel": {Key: "J", CmdOrCtrl: true},
	"view.commandPalette":        {Key: "P", CmdOrCtrl: true, Shift: true},
	"view.find":                  {Key: "F", CmdOrCtrl: true},
	"view.refresh":               {Key: "F5"},
	"view.run":                   {Key: "Return", CmdOrCtrl: true},
	"view.runAll":                {Key: "Return", CmdOrCtrl: true, Shift: true},
	"tab.next":                   {Key: "Tab", Ctrl: true},
	"tab.prev":                   {Key: "Tab", Ctrl: true, Shift: true},
	"tab.close":                  {Key: "W", CmdOrCtrl: true},
	"window.close":               {Key: "W", CmdOrCtrl: true, Shift: true},
}
