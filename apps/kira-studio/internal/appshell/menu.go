// Package appshell is Kira Studio's own residue of the app-shell composition (P103 Part 3): the
// generic half (window/menu/quit/close-flush machinery, the deferred Wails adapters) is repo-root
// internal/shell, shared with Kira Space; this package is everything left over that is genuinely
// this app's own — its own menu content, its own dialog request-struct adapter, its own stream
// registration and system-wake hook. A distinct package name (not "shell") so one main.go can
// import both repo-root internal/shell and this package with no alias.
package appshell

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/internal/shell"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// BuildTemplate is the direct analogue of buildMenu({isDev}) (src/main/menu.ts). Same four
// sections, same order, same labels, same accelerators.
func BuildTemplate(appName string, isDev bool) []shell.Section {
	appSection := shell.Section{
		Label: appName,
		Items: []shell.Item{
			{Kind: shell.ItemRole, Role: application.About},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemEmit, Label: "New Connection", Accelerator: shell.Shortcuts["app.newConnection"].Accelerator(), Channel: bridge.ChannelNewConnection},
			// P28 D18: three actions that were prominent panel buttons for how rarely they are used
			// — the two imports outright, New Request additionally (its panel + button stays, since
			// creating a request is frequent and the panel is where the collections are). No
			// accelerators: none is frequent enough to spend one, and accel.go's Shortcuts map is
			// deliberately untouched.
			{Kind: shell.ItemEmit, Label: "New Request", Channel: bridge.ChannelNewRequest},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemEmit, Label: "Import Postman Collection…", Channel: bridge.ChannelImportPostman},
			{Kind: shell.ItemEmit, Label: "Import DataGrip Connections…", Channel: bridge.ChannelImportDataGrip},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemEmit, Label: "Settings…", Accelerator: shell.Shortcuts["app.settings"].Accelerator(), Channel: bridge.ChannelOpenSettings},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemRole, Role: application.ServicesMenu},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemRole, Role: application.Hide},
			{Kind: shell.ItemRole, Role: application.HideOthers},
			// Electron's role: 'unhide' maps to ShowAll, never Wails' own dead UnHide role
			// (P56 §1.4).
			{Kind: shell.ItemRole, Role: application.ShowAll},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemQuit, Label: "Quit " + appName, Accelerator: "CmdOrCtrl+Q"},
		},
	}

	editSection := shell.Section{
		Label: "Edit",
		Items: []shell.Item{
			{Kind: shell.ItemRole, Role: application.Undo},
			{Kind: shell.ItemRole, Role: application.Redo},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemRole, Role: application.Cut},
			{Kind: shell.ItemRole, Role: application.Copy},
			{Kind: shell.ItemRole, Role: application.Paste},
			{Kind: shell.ItemRole, Role: application.SelectAll},
		},
	}

	viewItems := []shell.Item{
		{Kind: shell.ItemEmit, Label: "Toggle Project Panel", Accelerator: shell.Shortcuts["view.toggleProjectPanel"].Accelerator(), Channel: bridge.ChannelToggleProjectPanel},
		{Kind: shell.ItemEmit, Label: "Toggle Operations Panel", Accelerator: shell.Shortcuts["view.toggleOperationsPanel"].Accelerator(), Channel: bridge.ChannelToggleOperationsPanel},
		{Kind: shell.ItemSeparator},
		{Kind: shell.ItemEmit, Label: "Command Palette…", Accelerator: shell.Shortcuts["view.commandPalette"].Accelerator(), Channel: bridge.ChannelCommandPalette},
		{Kind: shell.ItemEmit, Label: "Find", Accelerator: shell.Shortcuts["view.find"].Accelerator(), Channel: bridge.ChannelViewFind},
		{Kind: shell.ItemEmit, Label: "Refresh", Accelerator: shell.Shortcuts["view.refresh"].Accelerator(), Channel: bridge.ChannelViewRefresh},
		{Kind: shell.ItemEmit, Label: "Run Statement", Accelerator: shell.Shortcuts["view.run"].Accelerator(), Channel: bridge.ChannelViewRun},
		{Kind: shell.ItemEmit, Label: "Run All", Accelerator: shell.Shortcuts["view.runAll"].Accelerator(), Channel: bridge.ChannelViewRunAll},
		{Kind: shell.ItemEmit, Label: "Format", Accelerator: shell.Shortcuts["view.format"].Accelerator(), Channel: bridge.ChannelViewFormat},
	}
	if isDev {
		viewItems = append(viewItems,
			shell.Item{Kind: shell.ItemSeparator},
			shell.Item{Kind: shell.ItemRole, Role: application.Reload},
			shell.Item{Kind: shell.ItemRole, Role: application.OpenDevTools},
		)
	}
	viewSection := shell.Section{Label: "View", Items: viewItems}

	windowSection := shell.Section{
		Label: "Window",
		Items: []shell.Item{
			{Kind: shell.ItemEmit, Label: "Next Tab", Accelerator: shell.Shortcuts["tab.next"].Accelerator(), Channel: bridge.ChannelTabNext},
			{Kind: shell.ItemEmit, Label: "Previous Tab", Accelerator: shell.Shortcuts["tab.prev"].Accelerator(), Channel: bridge.ChannelTabPrev},
			{Kind: shell.ItemEmit, Label: "Close Tab", Accelerator: shell.Shortcuts["tab.close"].Accelerator(), Channel: bridge.ChannelTabClose},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemNewWindow, Label: "New Window", Accelerator: shell.Shortcuts["window.new"].Accelerator()},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemRole, Role: application.Minimise},
			{Kind: shell.ItemRole, Role: application.Zoom},
			// role: 'close' defaults to CmdOrCtrl+W, which "Close Tab" above already claims —
			// re-accelerated to Shift+W (menu.ts:120-122's deliberate remap).
			{Kind: shell.ItemRole, Role: application.CloseWindow, Accelerator: shell.Shortcuts["window.close"].Accelerator()},
		},
	}

	return []shell.Section{appSection, editSection, viewSection, windowSection}
}
