package gitsession

import (
	"os"
	"testing"

	"github.com/kirathecat/kira-studio/internal/testx"
)

func TestMain(m *testing.M) { os.Exit(testx.RunWithTempHomes(m)) }
