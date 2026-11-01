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
		{"failure", "", errors.New("exit 1"), ""},
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
