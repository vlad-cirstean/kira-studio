// The console tokenizer, unit-level, no container (C12, per docs/v1/plans/P58c-mongo-redis.md
// §5.5): three interacting rules and one error, and it is the console's entire input path.
package redis

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
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
