//go:build darwin

package shell

import "github.com/wailsapp/wails/v3/pkg/application"

// unhideApp undoes Cmd+H. darwin only: on Windows and Linux App.Show re-shows every window.
func unhideApp() {
	if a := application.Get(); a != nil {
		a.Show()
	}
}
