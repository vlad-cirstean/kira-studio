package shell

import "github.com/wailsapp/wails/v3/pkg/application"

// SecurityOptions is the hardened posture applied to the main window (§1.6): deny every
// capability prompt except clipboard reads (the renderer's copy-cell/copy-row actions depend on
// it), and forbid window.open from firing without a user gesture.
type SecurityOptions struct {
	Permissions map[application.PermissionType]application.Permission
	Webview     application.MacWebviewPreferences
}

// Harden returns the locked-down posture every window uses. There is exactly one caller
// (window.go's Options), so this returns a value rather than mutating one in place.
func Harden() SecurityOptions {
	return SecurityOptions{
		Permissions: map[application.PermissionType]application.Permission{
			application.PermissionMicrophone:    application.PermissionDeny,
			application.PermissionCamera:        application.PermissionDeny,
			application.PermissionGeolocation:   application.PermissionDeny,
			application.PermissionNotifications: application.PermissionDeny,
			application.PermissionClipboardRead: application.PermissionAllow,
		},
		Webview: application.MacWebviewPreferences{
			JavaScriptCanOpenWindowsAutomatically: application.Disabled,
		},
	}
}
