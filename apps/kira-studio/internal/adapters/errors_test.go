package adapters_test

import (
	"errors"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
)

func TestAssertNoTransactionEscalation(t *testing.T) {
	tests := []struct {
		name       string
		statements []string
		wantReject bool
	}{
		{"plain read write", []string{"SET TRANSACTION READ WRITE"}, true},
		{"case insensitive", []string{"set transaction read write"}, true},
		{"session variant", []string{"SET SESSION TRANSACTION READ WRITE"}, true},
		{"tab between words", []string{"SET TRANSACTION READ\tWRITE"}, true},
		{"newline between words", []string{"SET TRANSACTION READ\nWRITE"}, true},
		{"line comment before phrase", []string{"-- flip it\nSET TRANSACTION READ WRITE"}, true},
		{"line comment does not merge words across lines", []string{"SET TRANSACTION READ -- comment\nWRITE"}, true},
		// A block comment is lexical whitespace to a real SQL parser (confirmed against a real
		// Postgres server: READ/*x*/WRITE parses identically to READ WRITE), so it must still be
		// caught even though stripping it naively (deleting rather than blanking) would otherwise
		// glue READ and WRITE into one word and slip past the \s+ separator.
		{"block comment between words", []string{"SET TRANSACTION READ/*sneaky*/WRITE"}, true},
		{"block comment elsewhere in statement", []string{"SET /* note */ TRANSACTION READ WRITE"}, true},
		{"second statement in batch", []string{"SELECT 1", "SET TRANSACTION READ WRITE"}, true},
		{"ordinary read-only statement", []string{"SELECT 1"}, false},
		{"read only phrase is not read write", []string{"BEGIN READ ONLY"}, false},
		{"unrelated word write alone", []string{"UPDATE t SET note = 'write'"}, false},
		{"unrelated word read alone", []string{"SELECT * FROM t WHERE note = 'read'"}, false},
		{"empty batch", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := adapters.AssertNoTransactionEscalation(tt.statements)
			if tt.wantReject {
				var ae *adapters.Error
				if !errors.As(err, &ae) || ae.Code != adapters.CodeUnsupported {
					t.Fatalf("AssertNoTransactionEscalation(%v) = %v, want an E_UNSUPPORTED *adapters.Error", tt.statements, err)
				}
			} else if err != nil {
				t.Fatalf("AssertNoTransactionEscalation(%v) = %v, want nil", tt.statements, err)
			}
		})
	}
}
