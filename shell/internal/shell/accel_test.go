package shell

import "testing"

func TestShortcutAccelerators(t *testing.T) {
	tests := []struct {
		id   string
		want string
	}{
		{"app.settings", "CmdOrCtrl+,"},
		{"app.newConnection", "CmdOrCtrl+N"},
		{"view.toggleProjectPanel", "CmdOrCtrl+B"},
		{"view.toggleOperationsPanel", "CmdOrCtrl+J"},
		{"view.commandPalette", "CmdOrCtrl+Shift+P"},
		{"view.find", "CmdOrCtrl+F"},
		{"view.refresh", "F5"},
		{"view.run", "CmdOrCtrl+Return"},
		{"view.runAll", "CmdOrCtrl+Shift+Return"},
		{"tab.next", "Ctrl+Tab"},
		{"tab.prev", "Ctrl+Shift+Tab"},
		{"tab.close", "CmdOrCtrl+W"},
		{"window.close", "CmdOrCtrl+Shift+W"},
	}
	if len(Shortcuts) != len(tests) {
		t.Fatalf("Shortcuts has %d entries, want %d", len(Shortcuts), len(tests))
	}
	for _, tt := range tests {
		t.Run(tt.id, func(t *testing.T) {
			chord, ok := Shortcuts[tt.id]
			if !ok {
				t.Fatalf("Shortcuts[%q] missing", tt.id)
			}
			if got := chord.Accelerator(); got != tt.want {
				t.Errorf("Accelerator() = %q, want %q", got, tt.want)
			}
			// §1.4's regression guard: never the literal word "Control".
			if got := chord.Accelerator(); len(got) >= 7 && got[:7] == "Control" {
				t.Errorf("Accelerator() = %q, contains the invalid modifier %q", got, "Control")
			}
		})
	}
}
