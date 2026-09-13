package config

import "os"

// IsDev mirrors src/main/env.ts's `!app.isPackaged`: unpackaged means development or test — the
// only place the dev menu and DevTools exist. isProductionBuild (prod.go/prod_default.go) is the
// same "production" build tag the packaging path always passes and app.Env.Info().Debug already
// keys off, so a shipped build can never disagree with itself about whether it's a dev build
// (P29 F4) — unlike the .app/Contents/MacOS path heuristic this replaces, which failed open on an
// os.Executable() error and misread any packaged binary invoked from outside its bundle layout.
// KIRA_DEV overrides only a non-production build, which this Linux sandbox needs since a plain
// wails3-built binary here never sits inside a .app bundle either way; it is inert once
// isProductionBuild is true.
func IsDev() bool {
	if isProductionBuild {
		return false
	}
	if v, ok := os.LookupEnv("KIRA_DEV"); ok {
		return v != "0" && v != "false"
	}
	return true
}
