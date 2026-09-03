//go:build production

package config

// isProductionBuild mirrors the "production" build tag the packaging path always passes
// (build/darwin/Taskfile.yml's BUILD_FLAGS) — the same tag that already gates Wails' own
// app.Env.Info().Debug. Giving IsDev() this as its first, unconditional check means the two
// dev-build signals can no longer disagree in a shipped build (P29 F4).
const isProductionBuild = true
