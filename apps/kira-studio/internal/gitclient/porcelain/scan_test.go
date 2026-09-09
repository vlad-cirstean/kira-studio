package porcelain_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// TestLogScanArgs_DiffersFromLogSessionArgsInExactlyOneToken is G23's own exit-criterion item 2
// (§7.1/§7.4): LogScanArgs and LogSessionArgs must differ in exactly one argv token (the format
// string) — anything else would mean the two walks are no longer the same walk over the same rev
// set, breaking upstream probe 11's ordering-identity property.
func TestLogScanArgs_DiffersFromLogSessionArgsInExactlyOneToken(t *testing.T) {
	spec := porcelain.WalkSpec{Scope: "all"}
	sessionArgs := porcelain.LogSessionArgs(spec)
	scanArgs := porcelain.LogScanArgs(spec)
	if len(sessionArgs) != len(scanArgs) {
		t.Fatalf("argv length differs: session=%d scan=%d (%v vs %v)", len(sessionArgs), len(scanArgs), sessionArgs, scanArgs)
	}
	diffs := 0
	for i := range sessionArgs {
		if sessionArgs[i] != scanArgs[i] {
			diffs++
			if sessionArgs[i] != "--format="+porcelain.LogFormat || scanArgs[i] != "--format="+porcelain.ScanFormat {
				t.Fatalf("unexpected differing token at index %d: session=%q scan=%q", i, sessionArgs[i], scanArgs[i])
			}
		}
	}
	if diffs != 1 {
		t.Fatalf("argv differs in %d tokens, want exactly 1 (the format string): session=%v scan=%v", diffs, sessionArgs, scanArgs)
	}
}

// TestLogScanArgs_UsesSameWalkArgsCallAsLogSessionArgs pins D1's own load-bearing property: both
// argv builders' rev-set tail comes from the exact same WalkArgs(spec) call, never a string-patch
// of one builder's output onto the other.
func TestLogScanArgs_UsesSameWalkArgsCallAsLogSessionArgs(t *testing.T) {
	spec := porcelain.WalkSpec{Range: &porcelain.RangeSpec{Base: "main", Branch: "feature"}}
	scanArgs := porcelain.LogScanArgs(spec)
	want := porcelain.WalkArgs(spec)
	got := scanArgs[len(scanArgs)-len(want):]
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("LogScanArgs' rev-set tail = %v, want %v (WalkArgs(spec))", got, want)
	}
}

// joinFields builds one raw 0x1f-delimited record (as RecordSplitter would hand ParseScanRecord,
// i.e. with the record's own NUL terminator already stripped).
func joinFields(fields ...string) []byte {
	out := []byte(fields[0])
	for _, f := range fields[1:] {
		out = append(out, 0x1f)
		out = append(out, []byte(f)...)
	}
	return out
}

func scanRecordBytes(subject, body string) []byte {
	return joinFields(
		"abc123", "", "Ada", "ada@example.com", "1700000000",
		"Bea", "bea@example.com", "1700000100", "", subject, body,
	)
}

func TestParseScanRecord(t *testing.T) {
	t.Run("multi-paragraph body", func(t *testing.T) {
		rec := scanRecordBytes("subject line", "first paragraph\n\nsecond paragraph\n")
		got, err := porcelain.ParseScanRecord(rec)
		if err != nil {
			t.Fatalf("ParseScanRecord: %v", err)
		}
		want := porcelain.ScanRecord{
			SHA: "abc123", Subject: "subject line", Body: "first paragraph\n\nsecond paragraph",
			Author:    porcelain.CommitIdentity{Name: "Ada", Email: "ada@example.com", Timestamp: 1700000000},
			Committer: porcelain.CommitIdentity{Name: "Bea", Email: "bea@example.com", Timestamp: 1700000100},
		}
		if got != want {
			t.Fatalf("ParseScanRecord = %+v, want %+v", got, want)
		}
	})

	t.Run("body containing a literal 0x1f is absorbed by the final field, not split", func(t *testing.T) {
		rec := scanRecordBytes("subject", "body with a stray \x1f byte in it\n")
		got, err := porcelain.ParseScanRecord(rec)
		if err != nil {
			t.Fatalf("ParseScanRecord: %v", err)
		}
		if got.Body != "body with a stray \x1f byte in it" {
			t.Fatalf("Body = %q, want the stray 0x1f preserved verbatim", got.Body)
		}
	})

	t.Run("empty body", func(t *testing.T) {
		rec := scanRecordBytes("subject", "")
		got, err := porcelain.ParseScanRecord(rec)
		if err != nil {
			t.Fatalf("ParseScanRecord: %v", err)
		}
		if got.Body != "" {
			t.Fatalf("Body = %q, want empty", got.Body)
		}
	})

	t.Run("trailing newline is trimmed exactly once", func(t *testing.T) {
		rec := scanRecordBytes("subject", "line one\n\n")
		got, err := porcelain.ParseScanRecord(rec)
		if err != nil {
			t.Fatalf("ParseScanRecord: %v", err)
		}
		if got.Body != "line one\n" {
			t.Fatalf("Body = %q, want exactly one trailing newline trimmed", got.Body)
		}
	})

	t.Run("CRLF body is preserved verbatim apart from the trimmed trailing LF", func(t *testing.T) {
		rec := scanRecordBytes("subject", "line one\r\nline two\r\n")
		got, err := porcelain.ParseScanRecord(rec)
		if err != nil {
			t.Fatalf("ParseScanRecord: %v", err)
		}
		if got.Body != "line one\r\nline two\r" {
			t.Fatalf("Body = %q, want the trailing LF (not the CR) trimmed", got.Body)
		}
	})

	t.Run("a record shorter than ScanFieldCount fields is a parse error", func(t *testing.T) {
		rec := joinFields("abc123", "", "Ada")
		if _, err := porcelain.ParseScanRecord(rec); err == nil {
			t.Fatal("expected a parse error for a short record")
		}
	})

	t.Run("field indices track LogFormat exactly -- %P and %D are dropped, not misread as subject/body", func(t *testing.T) {
		rec := joinFields(
			"deadbeef", "parent1 parent2", "Ada", "ada@example.com", "1700000000",
			"Bea", "bea@example.com", "1700000100", "HEAD -> main, tag: v1.0", "the subject", "the body\n",
		)
		got, err := porcelain.ParseScanRecord(rec)
		if err != nil {
			t.Fatalf("ParseScanRecord: %v", err)
		}
		if got.SHA != "deadbeef" || got.Subject != "the subject" || got.Body != "the body" {
			t.Fatalf("got = %+v, want sha=deadbeef subject=%q body=%q (parents/decoration dropped)", got, "the subject", "the body")
		}
	})
}

// TestScanFormat_FieldCount pins ScanFormat's own %x1f count against ScanFieldCount, the same
// belt-and-suspenders LogFormat/FieldCount already get. %x1f appears in the format STRING as four
// literal characters ('%','x','1','f'), so this counts substring occurrences rather than the byte
// itself.
func TestScanFormat_FieldCount(t *testing.T) {
	got := 0
	rest := porcelain.ScanFormat
	for {
		i := indexOf(rest, "%x1f")
		if i < 0 {
			break
		}
		got++
		rest = rest[i+4:]
	}
	if got+1 != porcelain.ScanFieldCount {
		t.Fatalf("ScanFormat has %d %%x1f separators (%d fields), want ScanFieldCount = %d", got, got+1, porcelain.ScanFieldCount)
	}
}

func indexOf(s, substr string) int {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
