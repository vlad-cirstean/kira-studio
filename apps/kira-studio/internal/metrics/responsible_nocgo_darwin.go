//go:build darwin && !cgo

package metrics

// responsible_darwin.go is a cgo file, so CGO_ENABLED=0 GOOS=darwin excludes it regardless of its
// own build tag, and responsible_other.go's "!darwin" tag excludes it too — leaving
// responsiblePID/responsibilityTracked undefined and the package uncompilable from this sandbox
// (verified: the P7 plan's §1.4). This app never ships that way (build/darwin/Taskfile.yml pins
// CGO_ENABLED=1 for every darwin build task), but `go vet`/`go build` should still type-check the
// combination. Fails closed exactly as the real cgo implementation does on an unresolved pid — -1
// under includeHelper's rule means "exclude", under-counting rather than over-counting (P7 D5).
const responsibilityTracked = true

func responsiblePID(pid int32) int32 {
	return -1
}
