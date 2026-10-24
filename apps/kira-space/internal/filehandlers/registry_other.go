//go:build !(darwin && cgo && !server)

package filehandlers

// NewRegistry is the platform Registry: no default-app control outside the macOS app.
func NewRegistry() Registry { return Unsupported{} }
