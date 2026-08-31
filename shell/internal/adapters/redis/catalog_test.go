package redis

import (
	"context"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
)

// fakeScanner ports catalog-listing.spec.ts's fakeRedis (P58f D14): a scripted round per call,
// driving the truncation conjunction without a live server.
type fakeScanner struct {
	round func(call int) (keys []string, nextCursor uint64)
	calls []struct {
		cursor uint64
		match  string
		count  int64
	}
}

func (f *fakeScanner) Scan(_ context.Context, cursor uint64, match string, count int64) *goredis.ScanCmd {
	f.calls = append(f.calls, struct {
		cursor uint64
		match  string
		count  int64
	}{cursor, match, count})
	keys, nextCursor := f.round(len(f.calls) - 1)
	return goredis.NewScanCmdResult(keys, nextCursor, nil)
}

func TestListNamespaceChildren_SplitsOnFirstColonAfterPrefix(t *testing.T) {
	fake := &fakeScanner{round: func(int) ([]string, uint64) {
		return []string{"zebra:1", "apple:1", "counter", "banana"}, 0
	}}
	result, err := listNamespaceChildren(context.Background(), fake, "db0", nil, adapters.NewOpCtx("op1"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got := make([][2]string, len(result.Nodes))
	for i, n := range result.Nodes {
		got[i] = [2]string{n.Kind, n.Name}
	}
	want := [][2]string{{"namespace", "apple"}, {"namespace", "zebra"}, {"key", "banana"}, {"key", "counter"}}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestListNamespaceChildren_NestedLevelJoinsPrefixAndDedups(t *testing.T) {
	fake := &fakeScanner{round: func(int) ([]string, uint64) {
		return []string{"a:b:x", "a:b:y", "a:c"}, 0
	}}
	result, err := listNamespaceChildren(context.Background(), fake, "db0", []string{"a"}, adapters.NewOpCtx("op1"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(fake.calls) != 1 || fake.calls[0].match != "a:*" || fake.calls[0].count != scanCount {
		t.Fatalf("unexpected scan args: %+v", fake.calls)
	}
	got := make([][2]string, len(result.Nodes))
	for i, n := range result.Nodes {
		got[i] = [2]string{n.Kind, n.Name}
	}
	// deduped: "b" seen twice (a:b:x, a:b:y), kept once. A key node's own name is the full key, not
	// the local segment.
	want := [][2]string{{"namespace", "b"}, {"key", "a:c"}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestListNamespaceChildren_UnresolvedCursorRunsMaxRoundsAndTruncates(t *testing.T) {
	fake := &fakeScanner{round: func(call int) ([]string, uint64) {
		return nil, uint64(call + 1)
	}}
	result, err := listNamespaceChildren(context.Background(), fake, "db0", nil, adapters.NewOpCtx("op1"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(fake.calls) != maxScanRounds {
		t.Fatalf("got %d calls, want %d", len(fake.calls), maxScanRounds)
	}
	if result.Truncated == nil || !*result.Truncated {
		t.Fatalf("expected truncated=true, got %v", result.Truncated)
	}
}

func TestListNamespaceChildren_CompletesWithinCapReportsNoTruncation(t *testing.T) {
	fake := &fakeScanner{round: func(int) ([]string, uint64) {
		return []string{"onlykey"}, 0
	}}
	result, err := listNamespaceChildren(context.Background(), fake, "db0", nil, adapters.NewOpCtx("op1"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("got %d calls, want 1", len(fake.calls))
	}
	if result.Truncated != nil {
		t.Fatalf("expected no truncation flag, got %v", *result.Truncated)
	}
}

func TestListNamespaceChildren_AlreadyCancelledContextFailsBeforeFirstScan(t *testing.T) {
	fake := &fakeScanner{round: func(int) ([]string, uint64) { return nil, 0 }}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := listNamespaceChildren(ctx, fake, "db0", nil, adapters.NewOpCtx("op1"))
	if code, ok := adapters.CodeOf(err); !ok || code != adapters.CodeCancelled {
		t.Fatalf("expected E_CANCELLED, got %v", err)
	}
	if len(fake.calls) != 0 {
		t.Fatalf("expected zero scan calls, got %d", len(fake.calls))
	}
}
