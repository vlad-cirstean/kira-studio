package ghclient

import (
	"context"
	"testing"
)

// TestClientGet_NotOKDiscoveryNeverSpawnsTheApiCall proves D1's own "Client never returns a Go
// error, no spawn when auth status is not ok" rule — a not-found gh must short-circuit before the
// api-call runner is ever touched at all.
func TestClientGet_NotOKDiscoveryNeverSpawnsTheApiCall(t *testing.T) {
	discovery := NewDiscovery(fakeLocator{found: false}, &fakeRunner{}, &fakeClock{})
	apiRunner := &recordingRunner{}
	c := NewClient(discovery, apiRunner)

	prs, status := c.PullsForCommit(context.Background(), testRepo, "abc123")
	if status.Kind != KindNotFound {
		t.Fatalf("status.Kind = %q, want notFound", status.Kind)
	}
	if prs != nil {
		t.Fatalf("prs = %v, want nil", prs)
	}
	if apiRunner.lastArgs != nil {
		t.Fatalf("the api-call runner was invoked (%v) despite a not-found gh", apiRunner.lastArgs)
	}
}

func TestClientGet_UndecodableBodyIsForbidden(t *testing.T) {
	runner := &recordingRunner{result: Result{ExitCode: 0, Stdout: []byte("not json")}}
	c := testClient(t, runner)
	_, status := c.PullsForCommit(context.Background(), testRepo, "abc123")
	if status.Kind != KindForbidden {
		t.Fatalf("status.Kind = %q, want forbidden for an undecodable body", status.Kind)
	}
}

func TestClientGet_NonOKPropagatesClassifiedStatus(t *testing.T) {
	runner := &recordingRunner{result: Result{ExitCode: 1, Stderr: []byte("gh: Bad credentials (HTTP 401)")}}
	c := testClient(t, runner)
	_, status := c.PullsForCommit(context.Background(), testRepo, "abc123")
	if status.Kind != KindUnauthenticated {
		t.Fatalf("status.Kind = %q, want unauthenticated", status.Kind)
	}
}
