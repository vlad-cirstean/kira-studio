package memcheck

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

const (
	idA = "km_7h3kq9x2mfa4"
	idB = "km_2b8c4d6f8g0h"
	idC = "km_9c2d4e6f8g1h"
)

func block(id, fact, reason string) string {
	b := "// kira-memory origin=user scope=company\n// " + id + " " + fact + "\n"
	if reason != "" {
		b += "//   " + reason + "\n"
	}
	return b
}

type fake []Source

func (f fake) Files(context.Context) ([]Source, error) { return f, nil }

// TestCrossFileDrift: one id must carry the same text in every scanned file, including the staged
// set the hook reads from blobs.
func TestCrossFileDrift(t *testing.T) {
	files := fake{
		{"b.go", []byte(block(idA, "Port is 9090.", "Manifest."))},
		{"a.go", []byte("package a\n// legacy comment\n" + block(idA, "Port is 9090.", "Manifest."))},
		{"c.py", []byte("# kira-memory origin=user scope=company\n# " + idA + " Port is 8080.\n#   Manifest.\n")},
		{"d.go", []byte(block(idB, "Other.", "Why."))},
		{"README.md", []byte("# legacy doc\n\nno header here\n")},
		{"e.go", []byte(block(idC, "Other.", ""))},
		{"f.go", []byte(block(idC, "Other.", "Later reason."))},
		{"g.go", []byte(block(idC, "Other.", "Different reason."))},
	}
	var out, errOut bytes.Buffer
	if code := runCheck(context.Background(), files, &out, &errOut); code != 1 {
		t.Fatalf("code = %d, out=%q err=%q", code, out.String(), errOut.String())
	}
	// A reason-less copy never conflicts; two stated reasons that differ do (g.go against f.go).
	want := "c.py:2: " + idA + " differs from a.go:4"
	if !strings.Contains(errOut.String(), want) || !strings.Contains(errOut.String(), "g.go:2: "+idC+" differs from e.go:2") || !strings.Contains(errOut.String(), "memory-check: 2 problem(s)") {
		t.Errorf("stderr = %q, want %q", errOut.String(), want)
	}

	clean := fake{files[0], files[1], files[3], files[5], files[6]}
	out.Reset()
	errOut.Reset()
	if code := runCheck(context.Background(), clean, &out, &errOut); code != 0 || out.String() != "memory-check: 5 file(s), 5 fact(s) ok\n" {
		t.Errorf("clean run: code=%d out=%q err=%q", code, out.String(), errOut.String())
	}
}
