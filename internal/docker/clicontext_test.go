package docker

import (
	"context"
	"errors"
	"testing"
)

func TestCLIContextCache(t *testing.T) {
	tests := []struct {
		name string
		out  string
		err  error
		want string
	}{
		{"name", "colima\n", nil, "colima"},
		{"multi-line", "a\nb\n", nil, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			c := &cliContext{lookPath: func(string) (string, error) { return "/x/docker", nil }, run: func(context.Context, string, []string) ([]byte, error) {
				calls++
				return []byte(tc.out), tc.err
			}}
			for range 2 {
				if got := c.name(); got != tc.want {
					t.Fatalf("name = %q, want %q", got, tc.want)
				}
			}
			if calls != 1 {
				t.Fatalf("run calls = %d, want 1 (cached)", calls)
			}
			c.forget()
			c.name()
			if calls != 2 {
				t.Fatalf("run calls after forget = %d, want 2", calls)
			}
		})
	}
}

func TestCLIContextFallbackAndTransient(t *testing.T) {
	var calls [][]string
	fail := true
	c := &cliContext{lookPath: func(string) (string, error) { return "/x/docker", nil }, run: func(_ context.Context, _ string, args []string) ([]byte, error) {
		calls = append(calls, args)
		if fail {
			return nil, errors.New("timeout")
		}
		if args[1] == "show" {
			return nil, errors.New("usage")
		}
		return []byte("remote\n"), nil
	}}
	if got := c.name(); got != "" {
		t.Fatalf("name = %q, want empty", got)
	}
	c.name()
	if len(calls) != 4 {
		t.Fatalf("transient failure was cached: %d runs, want 4", len(calls))
	}
	fail = false
	if got := c.name(); got != "remote" {
		t.Fatalf("ls fallback name = %q, want remote", got)
	}
	n := len(calls)
	c.name()
	if len(calls) != n {
		t.Fatal("definite answer not cached")
	}
}
