package shell_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/shell"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// TestHarden_DenyByDefaultPosture pins the locked-down permission set §1.6 documents: every
// capability prompt denied except the clipboard read the renderer's copy actions depend on, and
// window.open forbidden from firing without a user gesture.
func TestHarden_DenyByDefaultPosture(t *testing.T) {
	sec := shell.Harden()

	wantDeny := []application.PermissionType{
		application.PermissionMicrophone,
		application.PermissionCamera,
		application.PermissionGeolocation,
		application.PermissionNotifications,
	}
	for _, p := range wantDeny {
		if got := sec.Permissions[p]; got != application.PermissionDeny {
			t.Errorf("Permissions[%v] = %v, want PermissionDeny", p, got)
		}
	}
	if got := sec.Permissions[application.PermissionClipboardRead]; got != application.PermissionAllow {
		t.Errorf("Permissions[ClipboardRead] = %v, want PermissionAllow", got)
	}
	if sec.Webview.JavaScriptCanOpenWindowsAutomatically != application.Disabled {
		t.Errorf("JavaScriptCanOpenWindowsAutomatically = %v, want Disabled", sec.Webview.JavaScriptCanOpenWindowsAutomatically)
	}
}

// TestOptions_FileDropDisabled: P56 §1.6 says EnableFileDrop must be left false — the app wires no
// data-file-drop-target element and no FilesDropped handler anywhere, so enabling it would only
// widen the webview's OS-level attack surface for a feature nothing uses. Regression test for the
// P2 R1 finding where this had drifted to true.
func TestOptions_FileDropDisabled(t *testing.T) {
	opts := shell.Options(shell.Harden(), model.WindowRecord{Key: "main"}, nil)

	if opts.EnableFileDrop {
		t.Error("EnableFileDrop = true, want false (§1.6: no data-file-drop-target consumer exists)")
	}
}
