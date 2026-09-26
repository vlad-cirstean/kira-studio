// Package appshell is Kira Space's own residue of the app-shell composition (P103 Part 3): the
// generic half (window/menu/quit/close-flush machinery, the deferred Wails adapters) is repo-root
// internal/shell, shared with Kira Studio; this package is everything left over that is genuinely
// this app's own — its own menu content, its own dialog request-struct adapter and its own stream
// registration. A distinct package name (not "shell") so one main.go can import both repo-root
// internal/shell and this package with no alias.
package appshell

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/internal/shell"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// BuildTemplate is Kira Space's own menu — Kira Studio's own BuildTemplate
// (apps/kira-studio/internal/appshell/menu.go) trimmed to this app's own commands: no connections/
// requests/import items, no command palette/find/run (this app has none of those). P116 G1-G4 grew
// this from the P103 Part 1 stub (App/Edit/Window only, no ItemEmit item at all): Settings…, a View
// section with the project-panel toggle, tab navigation, dev-only Reload/DevTools.
func BuildTemplate(appName string, isDev bool) []shell.Section {
	appItems := shell.AppMenuHead()
	appItems = append(appItems,
		shell.Item{Kind: shell.ItemEmit, Label: "Settings…", Accelerator: shell.Shortcuts["app.settings"].Accelerator(), Channel: bridge.ChannelOpenSettings},
		shell.Item{Kind: shell.ItemSeparator},
	)
	appItems = append(appItems, shell.AppMenuTail(appName)...)
	appSection := shell.Section{Label: appName, Items: appItems}

	editSection := shell.Section{Label: "Edit", Items: shell.EditMenu()}

	viewItems := []shell.Item{
		{Kind: shell.ItemEmit, Label: "Toggle Project Panel", Accelerator: shell.Shortcuts["view.toggleProjectPanel"].Accelerator(), Channel: bridge.ChannelToggleProjectPanel},
	}
	if isDev {
		viewItems = append(viewItems,
			shell.Item{Kind: shell.ItemSeparator},
			shell.Item{Kind: shell.ItemRole, Role: application.Reload},
			shell.Item{Kind: shell.ItemRole, Role: application.OpenDevTools},
		)
	}
	viewSection := shell.Section{Label: "View", Items: viewItems}

	// role: 'close' defaults to CmdOrCtrl+W, which "Close Tab" below now claims — re-accelerated to
	// Shift+W, Kira Studio's own remap (its menu.go's identical comment).
	windowItems := append([]shell.Item{
		{Kind: shell.ItemEmit, Label: "Next Tab", Accelerator: shell.Shortcuts["tab.next"].Accelerator(), Channel: bridge.ChannelTabNext},
		{Kind: shell.ItemEmit, Label: "Previous Tab", Accelerator: shell.Shortcuts["tab.prev"].Accelerator(), Channel: bridge.ChannelTabPrev},
		{Kind: shell.ItemEmit, Label: "Close Tab", Accelerator: shell.Shortcuts["tab.close"].Accelerator(), Channel: bridge.ChannelTabClose},
		{Kind: shell.ItemSeparator},
		{Kind: shell.ItemNewWindow, Label: "New Window", Accelerator: shell.Shortcuts["window.new"].Accelerator()},
		{Kind: shell.ItemSeparator},
	}, shell.WindowMenuTail(shell.Shortcuts["window.close"].Accelerator())...)
	windowSection := shell.Section{Label: "Window", Items: windowItems}

	return []shell.Section{appSection, editSection, viewSection, windowSection}
}
