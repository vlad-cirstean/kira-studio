package shell

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestHardenDeniesEveryPermissionExceptClipboardRead(t *testing.T) {
	sec := Harden()

	want := map[application.PermissionType]application.Permission{
		application.PermissionMicrophone:    application.PermissionDeny,
		application.PermissionCamera:        application.PermissionDeny,
		application.PermissionGeolocation:   application.PermissionDeny,
		application.PermissionNotifications: application.PermissionDeny,
		application.PermissionClipboardRead: application.PermissionAllow,
	}
	if len(sec.Permissions) != len(want) {
		t.Fatalf("got %d permission entries, want %d (every PermissionType must be pinned so a\nnewly-added type in a future Wails version doesn't silently fall through to PermissionDefault)",
			len(sec.Permissions), len(want))
	}
	for pt, wantPerm := range want {
		if got := sec.Permissions[pt]; got != wantPerm {
			t.Errorf("Permissions[%v] = %v, want %v", pt, got, wantPerm)
		}
	}
}

func TestHardenDisablesJavaScriptCanOpenWindowsAutomatically(t *testing.T) {
	sec := Harden()
	if sec.Webview.JavaScriptCanOpenWindowsAutomatically != application.Disabled {
		t.Errorf("JavaScriptCanOpenWindowsAutomatically = %v, want application.Disabled",
			sec.Webview.JavaScriptCanOpenWindowsAutomatically)
	}
}
