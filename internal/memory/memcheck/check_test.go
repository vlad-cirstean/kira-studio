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
)

func block(id, fact, reason string) string {
	return "// kira-memory origin=user scope=company\n// " + id + " fact: " + fact + "\n// " + id + " reason: " + reason + "\n"
}

type fake []Source

func (f fake) Files(context.Context) ([]Source, error) { return f, nil }

// TestCrossFileDrift: one id must carry the same text in every scanned file, including the staged
// set the hook reads from blobs.
func TestCrossFileDrift(t *testing.T) {
	files := fake{
		{"b.go", []byte(block(idA, "Port is 9090.", "Manifest."))},
		{"a.go", []byte("package a\n// legacy comment\n" + block(idA, "Port is 9090.", "Manifest."))},
		{"c.py", []byte("# kira-memory origin=user scope=company\n# " + idA + " fact: Port is 8080.\n# " + idA + " reason: Manifest.\n")},
		{"d.go", []byte(block(idB, "Other.", "Why."))},
		{"README.md", []byte("# legacy doc\n\nno header here\n")},
	}
	var out, errOut bytes.Buffer
	if code := runCheck(context.Background(), files, &out, &errOut); code != 1 {
		t.Fatalf("code = %d, out=%q err=%q", code, out.String(), errOut.String())
	}
	want := "c.py:2: " + idA + " differs from a.go:4"
	if !strings.Contains(errOut.String(), want) || !strings.Contains(errOut.String(), "memory-check: 1 problem(s)") {
		t.Errorf("stderr = %q, want %q", errOut.String(), want)
	}

	clean := fake{files[0], files[1], files[3]}
	out.Reset()
	errOut.Reset()
	if code := runCheck(context.Background(), clean, &out, &errOut); code != 0 || out.String() != "memory-check: 3 file(s), 3 fact(s) ok\n" {
		t.Errorf("clean run: code=%d out=%q err=%q", code, out.String(), errOut.String())
	}
}
