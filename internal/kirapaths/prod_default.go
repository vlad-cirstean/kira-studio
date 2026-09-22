//go:build !production

package kirapaths

// isProductionBuild is false for every non-packaging build (dev, test, this Linux sandbox) — see
// prod.go's counterpart for the packaged case.
const isProductionBuild = false
