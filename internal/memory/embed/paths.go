package embed

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/kirathecat/kira-studio/internal/memory/modelstore"
)

// ORTVersion is the pinned ONNX Runtime release. scripts/fetch-onnxruntime.sh and the macOS
// bundle task pin the same value; scripts/verify-packaging.sh S12 keeps them equal.
const ORTVersion = "1.29.1"

// ErrNoRuntime means this build or platform cannot run the embedding model.
var ErrNoRuntime = errors.New("no embedding runtime for this platform")

// ModelDir is where a spec's files live: <home>/models/<id>.
func ModelDir(home string, s Spec) string {
	return modelstore.ModelDir(home, s.ID)
}

// RuntimeLib locates the ONNX Runtime shared library: $KIRA_ORT_LIB, else the copy bundled in the
// macOS app's Frameworks directory.
func RuntimeLib() (string, error) {
	if p := os.Getenv("KIRA_ORT_LIB"); p != "" {
		return checkLib(p)
	}
	if runtime.GOOS != "darwin" {
		return "", fmt.Errorf("%w: set KIRA_ORT_LIB to libonnxruntime", ErrNoRuntime)
	}
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrNoRuntime, err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return checkLib(filepath.Join(filepath.Dir(exe), "..", "Frameworks", "libonnxruntime."+ORTVersion+".dylib"))
}

func checkLib(p string) (string, error) {
	if _, err := os.Stat(p); err != nil {
		return "", fmt.Errorf("%w: %v", ErrNoRuntime, err)
	}
	return p, nil
}
