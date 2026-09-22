package shell

import "github.com/wailsapp/wails/v3/pkg/application"

// MenuDeps is BuildMenu's dependencies — Kira Studio's own MenuDeps, trimmed: no Events field,
// since this app's own BuildTemplate has no ItemEmit item to route through one yet.
type MenuDeps struct {
	AppName   string
	Quit      func() // Quitter.RequestQuit
	NewWindow func()
}

// BuildMenu renders the template. Must be called after application.New (Wails' own role
// constructors read globalApplication.options.Name).
func BuildMenu(d MenuDeps) *application.Menu {
	root := application.NewMenu()
	for _, section := range BuildTemplate(d.AppName) {
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

	case ItemQuit:
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

func addItem(m *application.Menu, item *application.MenuItem) {
	m.Append(application.NewMenuFromItems(item))
}
