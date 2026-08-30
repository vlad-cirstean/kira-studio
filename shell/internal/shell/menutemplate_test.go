package shell

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func hasRole(sections []Section, role application.Role) bool {
	for _, s := range sections {
		for _, item := range s.Items {
			if item.Kind == ItemRole && item.Role == role {
				return true
			}
		}
	}
	return false
}

func TestPackagedBuildHasNoDevItems(t *testing.T) {
	sections := BuildTemplate("Kira Studio", false)
	if hasRole(sections, application.Reload) {
		t.Error("packaged build's template contains a Reload role item")
	}
	if hasRole(sections, application.OpenDevTools) {
		t.Error("packaged build's template contains an OpenDevTools role item")
	}
}

func TestDevBuildHasBothDevItems(t *testing.T) {
	sections := BuildTemplate("Kira Studio", true)
	if !hasRole(sections, application.Reload) {
		t.Error("dev build's template is missing the Reload role item")
	}
	if !hasRole(sections, application.OpenDevTools) {
		t.Error("dev build's template is missing the OpenDevTools role item")
	}
}

func TestSectionsAndLabelsMatchMenuTs(t *testing.T) {
	sections := BuildTemplate("Kira Studio", false)
	wantSectionLabels := []string{"Kira Studio", "Edit", "View", "Window"}
	if len(sections) != len(wantSectionLabels) {
		t.Fatalf("got %d sections, want %d", len(sections), len(wantSectionLabels))
	}
	for i, want := range wantSectionLabels {
		if sections[i].Label != want {
			t.Errorf("section[%d].Label = %q, want %q", i, sections[i].Label, want)
		}
	}

	type emitCase struct {
		label   string
		channel string
	}
	var got []emitCase
	for _, s := range sections {
		for _, item := range s.Items {
			if item.Kind == ItemEmit {
				got = append(got, emitCase{item.Label, item.Channel})
			}
		}
	}
	want := []emitCase{
		{"New Connection", bridge.ChannelNewConnection},
		{"Settings…", bridge.ChannelOpenSettings},
		{"Toggle Project Panel", bridge.ChannelToggleProjectPanel},
		{"Toggle Operations Panel", bridge.ChannelToggleOperationsPanel},
		{"Command Palette…", bridge.ChannelCommandPalette},
		{"Find", bridge.ChannelViewFind},
		{"Refresh", bridge.ChannelViewRefresh},
		{"Run Statement", bridge.ChannelViewRun},
		{"Run All", bridge.ChannelViewRunAll},
		{"Next Tab", bridge.ChannelTabNext},
		{"Previous Tab", bridge.ChannelTabPrev},
		{"Close Tab", bridge.ChannelTabClose},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d emitting items, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("emit item[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestQuitItemHasNoRole(t *testing.T) {
	sections := BuildTemplate("Kira Studio", false)
	var quit *Item
	for _, s := range sections {
		for i := range s.Items {
			if s.Items[i].Kind == ItemQuit {
				quit = &s.Items[i]
			}
		}
	}
	if quit == nil {
		t.Fatal("no ItemQuit found in the template")
	}
	if quit.Accelerator != "CmdOrCtrl+Q" {
		t.Errorf("Quit accelerator = %q, want CmdOrCtrl+Q", quit.Accelerator)
	}
	if quit.Role != application.NoRole {
		t.Errorf("Quit.Role = %v, want the zero value (NoRole) — §1.3's terminate: finding", quit.Role)
	}
}

func TestShowAllNotUnhide(t *testing.T) {
	sections := BuildTemplate("Kira Studio", false)
	if hasRole(sections, application.UnHide) {
		t.Error("template uses the dead UnHide role")
	}
	if !hasRole(sections, application.ShowAll) {
		t.Error("template is missing the ShowAll role (Electron's role: 'unhide' analogue)")
	}
}

func TestCloseWindowIsReaccelerated(t *testing.T) {
	sections := BuildTemplate("Kira Studio", false)
	var closeWindow *Item
	for _, s := range sections {
		for i := range s.Items {
			if s.Items[i].Kind == ItemRole && s.Items[i].Role == application.CloseWindow {
				closeWindow = &s.Items[i]
			}
		}
	}
	if closeWindow == nil {
		t.Fatal("no CloseWindow role item found")
	}
	if closeWindow.Accelerator != "CmdOrCtrl+Shift+W" {
		t.Errorf("CloseWindow.Accelerator = %q, want CmdOrCtrl+Shift+W (not the role's default CmdOrCtrl+W)", closeWindow.Accelerator)
	}
}
