package shell

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ItemKind discriminates menutemplate.go's plain-struct items (D14: Wails-free, so
// menutemplate_test.go can assert the template without a running app).
type ItemKind int

const (
	ItemSeparator ItemKind = iota
	ItemRole               // a Wails role, optionally re-accelerated
	ItemEmit               // a custom item emitting Channel
	ItemQuit               // the custom, role-free Quit item (§1.3)
)

// Item.Role is application.Role, so this file is not literally Wails-free — but Role is a bare
// uint constant in roles.go with no cgo behind it, and the package as a whole imports Wails for
// menu.go anyway (§1.8). Stated plainly rather than pretending the split buys a build-tag win it
// does not.
type Item struct {
	Kind        ItemKind
	Label       string           // ItemEmit / ItemQuit only
	Role        application.Role // ItemRole only
	Accelerator string           // "" for none; also used to re-accelerate an ItemRole
	Channel     string           // ItemEmit only, a bridge.Channel* constant
}

type Section struct {
	Label string
	Items []Item
}

// BuildTemplate is the direct analogue of buildMenu({isDev}) (src/main/menu.ts). Same four
// sections, same order, same labels, same accelerators.
func BuildTemplate(appName string, isDev bool) []Section {
	appSection := Section{
		Label: appName,
		Items: []Item{
			{Kind: ItemRole, Role: application.About},
			{Kind: ItemSeparator},
			{Kind: ItemEmit, Label: "New Connection", Accelerator: Shortcuts["app.newConnection"].Accelerator(), Channel: bridge.ChannelNewConnection},
			{Kind: ItemEmit, Label: "Settings…", Accelerator: Shortcuts["app.settings"].Accelerator(), Channel: bridge.ChannelOpenSettings},
			{Kind: ItemSeparator},
			{Kind: ItemRole, Role: application.ServicesMenu},
			{Kind: ItemSeparator},
			{Kind: ItemRole, Role: application.Hide},
			{Kind: ItemRole, Role: application.HideOthers},
			// Electron's role: 'unhide' maps to ShowAll, never Wails' own dead UnHide role
			// (P56 §1.4).
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

	viewItems := []Item{
		{Kind: ItemEmit, Label: "Toggle Project Panel", Accelerator: Shortcuts["view.toggleProjectPanel"].Accelerator(), Channel: bridge.ChannelToggleProjectPanel},
		{Kind: ItemEmit, Label: "Toggle Operations Panel", Accelerator: Shortcuts["view.toggleOperationsPanel"].Accelerator(), Channel: bridge.ChannelToggleOperationsPanel},
		{Kind: ItemSeparator},
		{Kind: ItemEmit, Label: "Command Palette…", Accelerator: Shortcuts["view.commandPalette"].Accelerator(), Channel: bridge.ChannelCommandPalette},
		{Kind: ItemEmit, Label: "Find", Accelerator: Shortcuts["view.find"].Accelerator(), Channel: bridge.ChannelViewFind},
		{Kind: ItemEmit, Label: "Refresh", Accelerator: Shortcuts["view.refresh"].Accelerator(), Channel: bridge.ChannelViewRefresh},
		{Kind: ItemEmit, Label: "Run Statement", Accelerator: Shortcuts["view.run"].Accelerator(), Channel: bridge.ChannelViewRun},
		{Kind: ItemEmit, Label: "Run All", Accelerator: Shortcuts["view.runAll"].Accelerator(), Channel: bridge.ChannelViewRunAll},
	}
	if isDev {
		viewItems = append(viewItems,
			Item{Kind: ItemSeparator},
			Item{Kind: ItemRole, Role: application.Reload},
			Item{Kind: ItemRole, Role: application.OpenDevTools},
		)
	}
	viewSection := Section{Label: "View", Items: viewItems}

	windowSection := Section{
		Label: "Window",
		Items: []Item{
			{Kind: ItemEmit, Label: "Next Tab", Accelerator: Shortcuts["tab.next"].Accelerator(), Channel: bridge.ChannelTabNext},
			{Kind: ItemEmit, Label: "Previous Tab", Accelerator: Shortcuts["tab.prev"].Accelerator(), Channel: bridge.ChannelTabPrev},
			{Kind: ItemEmit, Label: "Close Tab", Accelerator: Shortcuts["tab.close"].Accelerator(), Channel: bridge.ChannelTabClose},
			{Kind: ItemSeparator},
			{Kind: ItemRole, Role: application.Minimise},
			{Kind: ItemRole, Role: application.Zoom},
			// role: 'close' defaults to CmdOrCtrl+W, which "Close Tab" above already claims —
			// re-accelerated to Shift+W (menu.ts:120-122's deliberate remap).
			{Kind: ItemRole, Role: application.CloseWindow, Accelerator: Shortcuts["window.close"].Accelerator()},
		},
	}

	return []Section{appSection, editSection, viewSection, windowSection}
}
