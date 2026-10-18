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

func doc(id, fact, reason string) string { return docKind(id, fact, reason, "Facts") }

func docKind(id, fact, reason, category string) string {
	b := "---\nkira-memory: 3\ngroup: kg_4m9xq2c7v8ab\ntitle: T\norigin: user\nscope: company\n---\n\n## " + category + "\n\n- " + id + " " + fact + "\n"
	if reason != "" {
		b += "  " + reason + "\n"
	}
	return b
}

type fake []Source

func (f fake) Files(context.Context) ([]Source, error) { return f, nil }

// TestCrossFileDrift: one id must carry the same text in every scanned doc, including the staged
// set the hook reads from blobs. A rule and a fact sharing an id drift too. A code file only reports a retired block header.
func TestCrossFileDrift(t *testing.T) {
	files := fake{
		{"b.memory.md", []byte(doc(idA, "Port is 9090.", "Manifest."))},
		{"a.memory.md", []byte(doc(idA, "Port is 9090.", "Manifest."))},
		{"c.memory.md", []byte(doc(idA, "Port is 8080.", "Manifest."))},
		{"d.memory.md", []byte(doc(idB, "Other.", "Why."))},
		{"README.md", []byte("# legacy doc\n\nno header here\n")},
		{"e.memory.md", []byte(doc(idC, "Other.", ""))},
		{"f.memory.md", []byte(doc(idC, "Other.", "Later reason."))},
		{"g.memory.md", []byte(doc(idC, "Other.", "Different reason."))},
		{"h.memory.md", []byte(docKind(idB, "Other.", "Why.", "Rules"))},
		{"old.go", []byte("package a\n\n// " + "kira-memory origin=user scope=company\n// " + idA + " Port is 9090.\n")},
		{"plain.go", []byte("package a\n\n// Ports are fixed by the manifest (" + idA + ").\n")},
	}
	var out, errOut bytes.Buffer
	if code := runCheck(context.Background(), files, &out, &errOut); code != 1 {
		t.Fatalf("code = %d, out=%q err=%q", code, out.String(), errOut.String())
	}
	// A reason-less copy never conflicts; two stated reasons that differ do (g against f).
	for _, want := range []string{
		"c.memory.md:11: " + idA + " differs from a.memory.md:11",
		"g.memory.md:11: " + idC + " differs from e.memory.md:11",
		"h.memory.md:11: " + idB + " differs from d.memory.md:11",
		"old.go:3: kira-memory comment blocks are retired (P296)",
		"memory-check: 4 problem(s)",
	} {
		if !strings.Contains(errOut.String(), want) {
			t.Errorf("stderr = %q, want %q", errOut.String(), want)
		}
	}

	clean := fake{files[0], files[1], files[3], files[5], files[6], files[10]}
	out.Reset()
	errOut.Reset()
	if code := runCheck(context.Background(), clean, &out, &errOut); code != 0 || out.String() != "memory-check: 6 file(s), 5 fact(s) ok\n" {
		t.Errorf("clean run: code=%d out=%q err=%q", code, out.String(), errOut.String())
	}
}
