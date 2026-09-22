package logging

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

// TestSetLevel is P72 §9.2's own regression guard: advanced.gitLogLevel shipped with no consumer
// (finding 1b) — this proves SetLevel genuinely moves the process handler's threshold, not just
// that it accepts a string. Uses the package's own `level` LevelVar, the same one Init wires into
// the real handler, rather than a private one, so a wiring regression there would fail this too.
func TestSetLevel(t *testing.T) {
	t.Cleanup(func() { SetLevel("info") })

	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: &level}))

	SetLevel("debug")
	logger.Debug("debug line")
	if !strings.Contains(buf.String(), "debug line") {
		t.Fatalf("SetLevel(\"debug\") did not enable debug-level logging, got %q", buf.String())
	}

	buf.Reset()
	SetLevel("off")
	logger.Error("error line")
	if buf.Len() != 0 {
		t.Fatalf("SetLevel(\"off\") did not silence error-level logging, got %q", buf.String())
	}
}

func TestSetLevel_UnrecognizedIsNoOp(t *testing.T) {
	t.Cleanup(func() { SetLevel("info") })

	SetLevel("debug")
	SetLevel("bogus")
	if level.Level() != slog.LevelDebug {
		t.Fatalf("SetLevel(\"bogus\") changed the level to %v, want unchanged debug", level.Level())
	}
}
