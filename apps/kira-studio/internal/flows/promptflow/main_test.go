package promptflow

import (
	"os"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
)

func TestMain(m *testing.M) { os.Exit(flowharness.Main(m)) }
