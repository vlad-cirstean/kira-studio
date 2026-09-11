package porcelain_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// readShowFixture reads a `show -s -z --format=...` fixture and returns its own single record
// with the -z terminator already removed — ParseShowBodyAndSignature's contract, like
// ParseLogRecord's, is to receive a record RecordSplitter already framed, never raw -z stdout.
func readShowFixture(t *testing.T, relPath string) []byte {
	t.Helper()
	raw := readDiffFixture(t, relPath)
	splitter := porcelain.NewRecordSplitter(0)
	recs, err := splitter.Push(raw)
	if err != nil {
		t.Fatalf("split %s: %v", relPath, err)
	}
	if flushed := splitter.Flush(); flushed != nil {
		t.Fatalf("%s: unterminated trailing bytes: %q", relPath, flushed)
	}
	if len(recs) != 1 {
		t.Fatalf("%s: got %d records, want exactly 1", relPath, len(recs))
	}
	return recs[0]
}

func TestParseShowBodyAndSignature_Trailers(t *testing.T) {
	t.Parallel()
	sig, trailers, body, err := porcelain.ParseShowBodyAndSignature(readShowFixture(t, "show/trailers.bin"))
	if err != nil {
		t.Fatalf("ParseShowBodyAndSignature: %v", err)
	}
	if sig.Status != "N" {
		t.Fatalf("status = %q, want N (unsigned)", sig.Status)
	}
	want := []porcelain.CommitTrailer{
		{Token: "Reviewed-by", Value: "Alice <alice@example.com>"},
		{Token: "Signed-off-by", Value: "Bob <bob@example.com>"},
	}
	if !reflect.DeepEqual(trailers, want) {
		t.Fatalf("trailers = %+v, want %+v", trailers, want)
	}
	if body != "Body paragraph one." {
		t.Fatalf("body = %q, want the trailer paragraph removed", body)
	}
}

// TestParseShowBodyAndSignature_Signed proves probe P5 held: the container's own inability to
// verify an SSH signature (no allowedSignersFile configured) writes to stderr but never disturbs
// the parsed record — classification stays by exit code, exactly the same %G?="N" shape an
// unsigned commit produces, and the record still parses cleanly.
func TestParseShowBodyAndSignature_Signed(t *testing.T) {
	t.Parallel()
	sig, trailers, body, err := porcelain.ParseShowBodyAndSignature(readShowFixture(t, "show/signed.bin"))
	if err != nil {
		t.Fatalf("ParseShowBodyAndSignature: %v", err)
	}
	if sig.Status != "N" {
		t.Fatalf("status = %q", sig.Status)
	}
	if len(trailers) != 0 {
		t.Fatalf("trailers = %+v, want none", trailers)
	}
	if body != "" {
		t.Fatalf("body = %q, want empty (subject-only commit)", body)
	}
}

func TestParseShowBodyAndSignature_EmptyBody(t *testing.T) {
	t.Parallel()
	_, trailers, body, err := porcelain.ParseShowBodyAndSignature(readShowFixture(t, "show/emptyBody.bin"))
	if err != nil {
		t.Fatalf("ParseShowBodyAndSignature: %v", err)
	}
	if len(trailers) != 0 || body != "" {
		t.Fatalf("trailers=%+v body=%q, want both empty", trailers, body)
	}
}

// TestParseShowBodyAndSignature_BodyIsAllTrailers proves SplitTrailerBlock's paragraph rule: a
// body whose only paragraph is trailer-shaped is removed entirely, leaving an empty body — never a
// dangling blank line.
func TestParseShowBodyAndSignature_BodyIsAllTrailers(t *testing.T) {
	t.Parallel()
	_, trailers, body, err := porcelain.ParseShowBodyAndSignature(readShowFixture(t, "show/bodyIsAllTrailers.bin"))
	if err != nil {
		t.Fatalf("ParseShowBodyAndSignature: %v", err)
	}
	if len(trailers) != 1 || trailers[0].Token != "Signed-off-by" {
		t.Fatalf("trailers = %+v", trailers)
	}
	if body != "" {
		t.Fatalf("body = %q, want empty (the whole body was the trailer paragraph)", body)
	}
}

// --- SplitTrailerBlock's own paragraph-rule cases (D16), independent of any fixture. ---

func TestSplitTrailerBlock_NoTrailers(t *testing.T) {
	t.Parallel()
	body := "Just a body, no trailers, with a colon: not a trailer."
	if got := porcelain.SplitTrailerBlock(body, nil); got != body {
		t.Fatalf("got %q, want unchanged (no trailers reported)", got)
	}
}

func TestSplitTrailerBlock_LastParagraphColonButNotATrailer(t *testing.T) {
	t.Parallel()
	// git reported no trailers even though the body's last paragraph contains a colon line — the
	// no-trailers short-circuit must leave it alone rather than second-guessing git.
	body := "Body.\n\nNote: this looks like a trailer but git did not parse it as one."
	if got := porcelain.SplitTrailerBlock(body, nil); got != body {
		t.Fatalf("got %q, want unchanged", got)
	}
}

func TestSplitTrailerBlock_FoldedContinuation(t *testing.T) {
	t.Parallel()
	body := "Body.\n\nSigned-off-by: Alice <alice@example.com>\n  (folded continuation line)"
	trailers := []porcelain.CommitTrailer{{Token: "Signed-off-by", Value: "Alice <alice@example.com>"}}
	if got := porcelain.SplitTrailerBlock(body, trailers); got != "Body." {
		t.Fatalf("got %q, want %q", got, "Body.")
	}
}

func TestSplitTrailerBlock_TrailingBlankLines(t *testing.T) {
	t.Parallel()
	body := "Body.\n\nSigned-off-by: Alice <alice@example.com>\n\n\n"
	trailers := []porcelain.CommitTrailer{{Token: "Signed-off-by", Value: "Alice <alice@example.com>"}}
	if got := porcelain.SplitTrailerBlock(body, trailers); got != "Body." {
		t.Fatalf("got %q, want %q", got, "Body.")
	}
}

func TestSplitTrailerBlock_BodyIsOnlyTrailers(t *testing.T) {
	t.Parallel()
	body := "Signed-off-by: Alice <alice@example.com>"
	trailers := []porcelain.CommitTrailer{{Token: "Signed-off-by", Value: "Alice <alice@example.com>"}}
	if got := porcelain.SplitTrailerBlock(body, trailers); got != "" {
		t.Fatalf("got %q, want empty", got)
	}
}
