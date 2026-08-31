package kafka_test

import (
	"os"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/adapters/testsupport"
)

// TestMain mirrors postgres_test.go's own: the container this whole package's tests share is torn
// down once, after every test has run — never from an individual test's t.Cleanup, which Go's
// testing package would run the instant the registering test function itself returns (P58b B15).
func TestMain(m *testing.M) {
	code := m.Run()
	testsupport.StopKafka()
	os.Exit(code)
}
