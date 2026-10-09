package claudeflow_test

import (
	"os"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == emulateArg {
		os.Exit(emulateMcp(os.Args[2:]))
	}
	os.Exit(flowharness.Main(m))
}
