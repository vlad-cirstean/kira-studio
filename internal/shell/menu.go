package shell

import "github.com/wailsapp/wails/v3/pkg/application"

// MenuDeps is BuildMenu's dependencies. P103 Part 3: Template replaces a call into each app's own
// BuildTemplate (menu.go can no longer import an app-specific one) — each app's own main.go builds
// its own template (via its own internal/appshell.BuildTemplate) and passes it in already built.
// OnEmit replaces the *bridge.Events field an ItemEmit item used to call Signal on directly — a
// template with no ItemEmit item (Kira Space's own, today) never calls it, so OnEmit may be nil
// there. NewWindow (P8 D8) is deliberately not routed through OnEmit like the other Window-section
// items: it is an ItemNewWindow, whose action runs in Go and never travels through the renderer
// (§0.4's "renderer opens no window").
type MenuDeps struct {
	AppName   string
	IsDev     bool
	Template  []Section
	OnEmit    func(channel string)
	Quit      func() // Quitter.RequestQuit
	NewWindow func()
}

// BuildMenu renders d.Template. It must be called after application.New, because Wails' own role
// constructors read globalApplication.options.Name (menuitem_roles.go) — §1.4.
func BuildMenu(d MenuDeps) *application.Menu {
	root := application.NewMenu()
	for _, section := range d.Template {
		sub := root.AddSubmenu(section.Label)
		for _, item := range section.Items {
			buildItem(sub, item, d)
		}
	}
	return root
}

func buildItem(sub *application.Menu, item Item, d MenuDeps) {
	switch item.Kind {
	case ItemSeparator:
		sub.AddSeparator()

	case ItemRole:
		roleItem := application.NewRole(item.Role)
		if roleItem == nil {
			return
		}
		if item.Accelerator != "" {
			roleItem.SetAccelerator(item.Accelerator)
		}
		addItem(sub, roleItem)

	case ItemEmit:
		channel := item.Channel
		emitItem := application.NewMenuItem(item.Label)
		if item.Accelerator != "" {
			emitItem.SetAccelerator(item.Accelerator)
		}
		// Wails runs menu callbacks on their own goroutine (menuitem.go:270-274), so no
		// dispatch of our own is needed here.
		emitItem.OnClick(func(*application.Context) { d.OnEmit(channel) })
		addItem(sub, emitItem)

	case ItemQuit:
		// No role, so menuItem.action stays handleClick rather than terminate: (§1.3) — the
		// only way this item's own label and click path stay ours.
		quitItem := application.NewMenuItem(item.Label)
		if item.Accelerator != "" {
			quitItem.SetAccelerator(item.Accelerator)
		}
		quitItem.OnClick(func(*application.Context) { d.Quit() })
		addItem(sub, quitItem)

	case ItemNewWindow:
		newWindowItem := application.NewMenuItem(item.Label)
		if item.Accelerator != "" {
			newWindowItem.SetAccelerator(item.Accelerator)
		}
		newWindowItem.OnClick(func(*application.Context) { d.NewWindow() })
		addItem(sub, newWindowItem)
	}
}

// addItem appends a pre-built item. *Menu exposes Add(label)/AddRole(role) but no exported
// "append this one" (menu.go:45-108); the Quit item and the re-accelerated Close item both have
// to be constructed before they can be added.
func addItem(m *application.Menu, item *application.MenuItem) {
	m.Append(application.NewMenuFromItems(item))
}
