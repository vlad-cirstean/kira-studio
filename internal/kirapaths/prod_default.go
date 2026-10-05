//go:build !production

package kirapaths

import "testing"

// isProductionBuild is false for every non-packaging build (dev, test, this Linux sandbox) — see
// prod.go's counterpart for the packaged case.
const isProductionBuild = false

// requireTestHome fails a test binary that would resolve an app home from $HOME, i.e. the real
// user's data. Tests set the env var; testx.RunWithTempHomes does it per package.
func requireTestHome(envVar string) {
	if testing.Testing() {
		panic("kirapaths: " + envVar + " unset in a test binary; call testx.RunWithTempHomes from TestMain")
	}
}
