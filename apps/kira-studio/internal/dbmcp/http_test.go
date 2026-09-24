package dbmcp

import (
	"fmt"
	"net"
	"strings"
	"testing"
)

// TestBindHTTPRefusesFallbackOnPortConflict guards F11: a DefaultPort conflict must refuse to
// start, never silently fall back to an OS-assigned ephemeral port — every existing registration
// names DefaultPort, and a fallback would leave it pointing at whatever else is now listening
// there, with the live bearer token going to it on the next connection attempt.
func TestBindHTTPRefusesFallbackOnPortConflict(t *testing.T) {
	occupied, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", DefaultPort))
	if err != nil {
		t.Skipf("cannot occupy DefaultPort %d to set up this test's own precondition: %v", DefaultPort, err)
	}
	t.Cleanup(func() { _ = occupied.Close() })

	s := &Server{}
	err = s.bindHTTP()
	if err == nil {
		t.Fatalf("bindHTTP succeeded despite DefaultPort %d being taken — want a refusal, not a fallback bind", DefaultPort)
	}
	if !strings.Contains(err.Error(), fmt.Sprintf("%d", DefaultPort)) {
		t.Fatalf("error = %q, want it to name the conflicting port", err.Error())
	}
	if s.listener != nil {
		t.Fatal("s.listener was set despite bindHTTP returning an error — no fallback listener must be left behind")
	}
}
