package id_test

import (
	"regexp"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/id"
)

var uuidShape = regexp.MustCompile(
	`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
)

func TestNewShapeAndVersion(t *testing.T) {
	for i := 0; i < 100; i++ {
		got := id.New()
		if !uuidShape.MatchString(got) {
			t.Fatalf("id.New() = %q, want canonical v4 shape", got)
		}
	}
}

func TestNewIsDistinct(t *testing.T) {
	seen := make(map[string]bool, 10_000)
	for i := 0; i < 10_000; i++ {
		got := id.New()
		if seen[got] {
			t.Fatalf("id.New() produced a duplicate: %s", got)
		}
		seen[got] = true
	}
}
