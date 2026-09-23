// Package appshell is Kira Space's own residue of the app-shell composition (P103 Part 3): the
// generic half (window/menu/quit/close-flush machinery, the deferred Wails adapters) is repo-root
// internal/shell, shared with Kira Studio; this package is everything left over that is genuinely
// this app's own — its own menu content, its own dialog request-struct adapter and its own stream
// registration. A distinct package name (not "shell") so one main.go can import both repo-root
// internal/shell and this package with no alias.
package appshell

import "github.com/kirathecat/kira-studio/internal/shell"

// BuildTemplate is Kira Space's own minimal menu: the standard macOS App/Edit/Window sections
// every Wails app needs, no Studio-specific commands (connections, requests, panels, tabs — none
// of which this app has). Part 2 adds a View section (and any Window-menu git commands) once
// there is a frontend to route them to.
func BuildTemplate(appName string) []shell.Section {
	appItems := shell.AppMenuHead()
	appItems = append(appItems, shell.AppMenuTail(appName)...)
	appSection := shell.Section{Label: appName, Items: appItems}

	editSection := shell.Section{Label: "Edit", Items: shell.EditMenu()}

	// role: 'close' defaults to CmdOrCtrl+W — no "Close Tab" here to collide with (Kira Studio's
	// own re-accelerate-to-Shift+W reason, menu.ts:120-122, does not apply), so this stays the
	// plain role default with no Accelerator override.
	windowItems := append([]shell.Item{
		{Kind: shell.ItemNewWindow, Label: "New Window", Accelerator: "CmdOrCtrl+Shift+N"},
		{Kind: shell.ItemSeparator},
	}, shell.WindowMenuTail("")...)
	windowSection := shell.Section{Label: "Window", Items: windowItems}

	return []shell.Section{appSection, editSection, windowSection}
}
