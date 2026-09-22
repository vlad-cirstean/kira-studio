package shell

import "github.com/wailsapp/wails/v3/pkg/application"

// ItemKind discriminates menutemplate.go's plain-struct items — Kira Studio's own precedent
// (menutemplate.go, D14), trimmed to the three kinds this app's own minimal menu (no frontend to
// emit a command to yet, P100 Part 1) actually uses. Kira Studio's own ItemEmit kind (a custom
// item broadcasting a bridge.Channel* constant to the renderer) has no Part 1 use here — Part 2's
// own menu commands (once there is a git-ui surface to emit them to) are what grows this file.
type ItemKind int

const (
	ItemSeparator ItemKind = iota
	ItemRole               // a Wails role, optionally re-accelerated
	ItemQuit               // the custom, role-free Quit item
	ItemNewWindow          // opens a second window, handled in Go
)

type Item struct {
	Kind        ItemKind
	Label       string // ItemQuit only
	Role        application.Role
	Accelerator string // "" for none
}

type Section struct {
	Label string
	Items []Item
}

// BuildTemplate is Kira Space's own minimal menu: the standard macOS App/Edit/Window sections
// every Wails app needs, no Studio-specific commands (connections, requests, panels, tabs — none
// of which this app has). Part 2 adds a View section (and any Window-menu git commands) once
// there is a frontend to route them to.
func BuildTemplate(appName string) []Section {
	appSection := Section{
		Label: appName,
		Items: []Item{
			{Kind: ItemRole, Role: application.About},
			{Kind: ItemSeparator},
			{Kind: ItemRole, Role: application.ServicesMenu},
			{Kind: ItemSeparator},
			{Kind: ItemRole, Role: application.Hide},
			{Kind: ItemRole, Role: application.HideOthers},
			{Kind: ItemRole, Role: application.ShowAll},
			{Kind: ItemSeparator},
			{Kind: ItemQuit, Label: "Quit " + appName, Accelerator: "CmdOrCtrl+Q"},
		},
	}

	editSection := Section{
		Label: "Edit",
		Items: []Item{
			{Kind: ItemRole, Role: application.Undo},
			{Kind: ItemRole, Role: application.Redo},
			{Kind: ItemSeparator},
			{Kind: ItemRole, Role: application.Cut},
			{Kind: ItemRole, Role: application.Copy},
			{Kind: ItemRole, Role: application.Paste},
			{Kind: ItemRole, Role: application.SelectAll},
		},
	}

	windowSection := Section{
		Label: "Window",
		Items: []Item{
			{Kind: ItemNewWindow, Label: "New Window", Accelerator: "CmdOrCtrl+Shift+N"},
			{Kind: ItemSeparator},
			{Kind: ItemRole, Role: application.Minimise},
			{Kind: ItemRole, Role: application.Zoom},
			// role: 'close' defaults to CmdOrCtrl+W — no "Close Tab" here to collide with (Kira
			// Studio's own re-accelerate-to-Shift+W reason, menu.ts:120-122, does not apply), so
			// this stays the plain role default with no Accelerator override.
			{Kind: ItemRole, Role: application.CloseWindow},
		},
	}

	return []Section{appSection, editSection, windowSection}
}
