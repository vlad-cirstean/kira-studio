// The console tokenizer, unit-level, no container (C12, per docs/v1/plans/P58c-mongo-redis.md
// §5.5): three interacting rules and one error, and it is the console's entire input path.
package redis

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
)

func TestTokenize_QuotedAndUnquoted(t *testing.T) {
	tokens, err := tokenize(`SET foo "bar baz"`)
	if err != nil {
		t.Fatalf("tokenize: %v", err)
	}
	want := []string{"SET", "foo", "bar baz"}
	if len(tokens) != len(want) {
		t.Fatalf("tokens = %v, want %v", tokens, want)
	}
	for i, w := range want {
		if tokens[i] != w {
			t.Errorf("tokens[%d] = %q, want %q", i, tokens[i], w)
		}
	}
}

func TestTokenize_SingleQuotes(t *testing.T) {
	tokens, err := tokenize(`SET foo 'bar baz'`)
	if err != nil {
		t.Fatalf("tokenize: %v", err)
	}
	if len(tokens) != 3 || tokens[2] != "bar baz" {
		t.Errorf("tokens = %v", tokens)
	}
}

func TestTokenize_EscapeInsideQuotes(t *testing.T) {
	tokens, err := tokenize(`SET foo "bar\"baz"`)
	if err != nil {
		t.Fatalf("tokenize: %v", err)
	}
	if len(tokens) != 3 || tokens[2] != `bar"baz` {
		t.Errorf("tokens = %v, want the escaped quote preserved literally", tokens)
	}
}

func TestTokenize_EscapeOutsideQuotesNotHonoured(t *testing.T) {
	// Outside quotes, a backslash is just another non-whitespace character — no escape handling.
	tokens, err := tokenize(`SET foo bar\baz`)
	if err != nil {
		t.Fatalf("tokenize: %v", err)
	}
	if len(tokens) != 3 || tokens[2] != `bar\baz` {
		t.Errorf("tokens = %v, want the backslash preserved literally", tokens)
	}
}

func TestTokenize_UnterminatedQuoteIsError(t *testing.T) {
	_, err := tokenize(`SET foo "bar`)
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	code, _ := adapters.CodeOf(err)
	if code != adapters.CodeQuery {
		t.Errorf("code = %v, want E_QUERY", code)
	}
	if err.Error() != "unterminated quoted string" {
		t.Errorf("message = %q, want the verbatim adapter message", err.Error())
	}
}

// kvEntry reads back page pg's own Field/Value at row i, for the resultToPage tests below.
func kvEntry(t *testing.T, pg page.KeyValuePage, i int) (field, value string) {
	t.Helper()
	f, v := testsupport.KVFieldAt(t, pg, i), testsupport.KVValueAt(t, pg, i)
	if f == nil || v == nil {
		t.Fatalf("row %d: field/value = %v/%v, want both non-nil", i, f, v)
	}
	return *f, *v
}

// TestResultToPage_HGETCarriesRealFieldName is finding #3 (M7): resultToPage previously named
// every scalar reply's Field after the upper-cased command ("HGET"), never the real hash field
// requested — so a mask rule on that field could never match it through run_query, though
// list_connections reported the connection as protected. HGET's own field name comes from the
// command's own argument, not the reply.
func TestResultToPage_HGETCarriesRealFieldName(t *testing.T) {
	pg := resultToPage("HGET", []string{"email"}, "person@example.com")
	if !pg.FieldsAreColumns {
		t.Fatal("FieldsAreColumns = false, want true — HGET's field name is real")
	}
	field, value := kvEntry(t, pg, 0)
	if field != "email" || value != "person@example.com" {
		t.Fatalf("entry = {%q %q}, want {email person@example.com}", field, value)
	}
}

// TestResultToPage_HMGETCarriesRealFieldNamesPositionally confirms each reply element is paired
// with the field name at the same position in the request, not a bare index.
func TestResultToPage_HMGETCarriesRealFieldNamesPositionally(t *testing.T) {
	pg := resultToPage("HMGET", []string{"email", "plan"}, []any{"person@example.com", "premium"})
	if !pg.FieldsAreColumns {
		t.Fatal("FieldsAreColumns = false, want true — HMGET's field names are real")
	}
	if pg.RowCount != 2 {
		t.Fatalf("RowCount = %d, want 2", pg.RowCount)
	}
	f0, v0 := kvEntry(t, pg, 0)
	f1, v1 := kvEntry(t, pg, 1)
	if f0 != "email" || v0 != "person@example.com" {
		t.Fatalf("entry 0 = {%q %q}, want {email person@example.com}", f0, v0)
	}
	if f1 != "plan" || v1 != "premium" {
		t.Fatalf("entry 1 = {%q %q}, want {plan premium}", f1, v1)
	}
}

// TestResultToPage_HGETALLCarriesRealFieldNames is the finding's own literal repro: run_query
// "HGETALL user:1" against a connection with an "email" mask rule must produce a page whose Field
// values are the real hash field names (from the RESP2 flat field/value reply), so
// renderKeyValuePage's ApplyColumn(field, value) actually has something to match against.
func TestResultToPage_HGETALLCarriesRealFieldNames(t *testing.T) {
	pg := resultToPage("HGETALL", nil, []any{"email", "person@example.com", "plan", "premium"})
	if !pg.FieldsAreColumns {
		t.Fatal("FieldsAreColumns = false, want true — HGETALL's field names are real")
	}
	if pg.RowCount != 2 {
		t.Fatalf("RowCount = %d, want 2", pg.RowCount)
	}
	f0, v0 := kvEntry(t, pg, 0)
	f1, v1 := kvEntry(t, pg, 1)
	if f0 != "email" || v0 != "person@example.com" {
		t.Fatalf("entry 0 = {%q %q}, want {email person@example.com}", f0, v0)
	}
	if f1 != "plan" || v1 != "premium" {
		t.Fatalf("entry 1 = {%q %q}, want {plan premium}", f1, v1)
	}
}

// TestResultToPage_GenericReplyIsNotFieldsAreColumns pins the safe default for every command
// outside hashReadCommands: GET's reply carries no real field name at all (the command name is a
// display artifact, not a column), so dbmcp's renderPage must refuse to mask this page rather than
// silently pass a value through under a Field nothing could ever match.
func TestResultToPage_GenericReplyIsNotFieldsAreColumns(t *testing.T) {
	pg := resultToPage("GET", []string{"user:1:email"}, "person@example.com")
	if pg.FieldsAreColumns {
		t.Fatal("FieldsAreColumns = true, want false — GET's reply has no real field name")
	}

	arr := resultToPage("SMEMBERS", nil, []any{"a", "b"})
	if arr.FieldsAreColumns {
		t.Fatal("FieldsAreColumns = true, want false — an array reply's index is not a real field name")
	}
}
