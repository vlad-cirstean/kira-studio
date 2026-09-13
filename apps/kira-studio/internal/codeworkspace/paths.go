package codeworkspace

import "github.com/kirathecat/kira-studio/apps/kira-studio/internal/pathsafe"

// ErrPathEscapesRoot aliases pathsafe.ErrPathEscapesRoot (moved there, C8 plan D6) so every
// existing errors.Is(err, ErrPathEscapesRoot) call site keeps working unchanged.
var ErrPathEscapesRoot = pathsafe.ErrPathEscapesRoot

// ValidateRelPath delegates to pathsafe.ValidateRelPath (moved there, C8 plan D6): the check itself
// is unchanged, this package just keeps its own call sites (diff.go, nav.go,
// bridge/codeworkspace.go) compiling against the name they already use.
func ValidateRelPath(root, relPath string) (string, error) {
	return pathsafe.ValidateRelPath(root, relPath)
}
