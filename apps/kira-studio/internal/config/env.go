package config

import (
	"os"
	"strings"
)

// IsDev mirrors src/main/env.ts's `!app.isPackaged`: unpackaged means development or test — the
// only place the dev menu and DevTools exist. Electron's own isPackaged has no Go analogue, so
// the equivalent signal is whether the running executable sits inside a macOS .app bundle
// (P52 §4.1). KIRA_DEV overrides it explicitly, which this Linux sandbox needs since a plain
// wails3-built binary here never sits inside a .app bundle either way.
func IsDev() bool {
	if v, ok := os.LookupEnv("KIRA_DEV"); ok {
		return v != "0" && v != "false"
	}
	exe, err := os.Executable()
	if err != nil {
		return true
	}
	return !strings.Contains(exe, ".app/Contents/MacOS")
}
