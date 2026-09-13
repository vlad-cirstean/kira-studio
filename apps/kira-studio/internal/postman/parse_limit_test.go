// parse_limit_test.go is P21 round 1 architecture/security finding 11: Parse read a user-chosen
// file whole into memory with no bound. This pins that an implausibly large collection is refused
// with a named error rather than read in full.
package postman_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/postman"
)

func TestParse_RefusesAnImplausiblyLargeFile(t *testing.T) {
	// One real "info" object followed by padding well past the 64 MiB bound, inside a JSON string
	// so it stays a single well-formed (if oversized) document — Parse must refuse before decoding
	// it, not fail on malformed JSON for an unrelated reason.
	const oneMiB = 1 << 20
	padding := strings.Repeat("x", 65*oneMiB)
	var buf bytes.Buffer
	buf.WriteString(`{"info":{"name":"big","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[],"padding":"`)
	buf.WriteString(padding)
	buf.WriteString(`"}`)

	_, err := postman.Parse(&buf)
	if err == nil {
		t.Fatal("Parse: expected a refusal for an implausibly large file, got nil")
	}
	if !strings.Contains(err.Error(), "larger than") {
		t.Fatalf("Parse err = %v, want a named size-refusal", err)
	}
}

func TestParse_AcceptsAnOrdinarilySizedFile(t *testing.T) {
	const small = `{"info":{"name":"small","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[]}`
	if _, err := postman.Parse(strings.NewReader(small)); err != nil {
		t.Fatalf("Parse: unexpected error for an ordinary file: %v", err)
	}
}
