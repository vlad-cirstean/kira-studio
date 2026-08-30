package shell_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/shell"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type noopEmitter struct{}

func (noopEmitter) Emit(string, any) {}

func allMenuItems(m *application.Menu) []*application.MenuItem {
	var out []*application.MenuItem
	for i := 0; ; i++ {
		item := m.ItemAt(i)
		if item == nil {
			return out
		}
		out = append(out, item)
	}
}

// TestBuildMenuAcceleratorsAllParse walks the real built *application.Menu alongside the
// Wails-free template that produced it (same appName/isDev, so the same items in the same
// order — BuildMenu appends exactly one built item per template item, separators included) and
// asserts that every template item carrying a non-empty Accelerator actually parsed: this is the
// test that catches SetAccelerator's silent failure mode (menuitem.go:275-287); without it a
// mistranslation (e.g. the "Control+Tab" trap, §1.4) is invisible.
func TestBuildMenuAcceleratorsAllParse(t *testing.T) {
	const appName = "Kira Studio Test"
	events := bridge.NewEvents(noopEmitter{})
	menu := shell.BuildMenu(shell.MenuDeps{AppName: appName, IsDev: true, Events: events, Quit: func() {}})
	template := shell.BuildTemplate(appName, true)

	builtSections := allMenuItems(menu)
	if len(builtSections) != len(template) {
		t.Fatalf("built menu has %d top-level sections, want %d", len(builtSections), len(template))
	}

	checked := 0
	for i, section := range template {
		sub := builtSections[i].GetSubmenu()
		if sub == nil {
			t.Fatalf("section %q has no submenu", section.Label)
		}
		builtItems := allMenuItems(sub)
		if len(builtItems) != len(section.Items) {
			t.Fatalf("section %q built %d items, want %d", section.Label, len(builtItems), len(section.Items))
		}
		for j, wantItem := range section.Items {
			if wantItem.Accelerator == "" {
				continue
			}
			checked++
			if got := builtItems[j].GetAccelerator(); got == "" {
				t.Errorf("section %q item %d (%q): GetAccelerator() = \"\", want the parsed form of %q",
					section.Label, j, wantItem.Label, wantItem.Accelerator)
			}
		}
	}
	if checked == 0 {
		t.Fatal("no accelerator-bearing items were checked — the test asserts nothing")
	}
}
