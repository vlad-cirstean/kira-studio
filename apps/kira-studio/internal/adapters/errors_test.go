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
		// Nested block comments (review finding, case 3): confirmed against a real Postgres server
		// that `READ /* /* */ x */ WRITE` parses identically to `READ WRITE` — the outer /* runs to
		// its own matching, correctly-nested */, so a non-nesting single regexp pass misses it.
		{"nested block comment collapses to read write", []string{"SET TRANSACTION READ /* /* */ x */ WRITE"}, true},
		{"doubly nested block comment", []string{"SET TRANSACTION READ /* a /* b /* c */ d */ e */ WRITE"}, true},
		// Naming the read-only GUC/session variable directly and assigning it a falsy value (review
		// finding, case 1): confirmed against a real Postgres server that `SET transaction_read_only
		// = off` inside the wrapping transaction flips it writable, with no "READ WRITE" phrase
		// anywhere for sqlReadWrite to catch.
		{"transaction_read_only off", []string{"SET transaction_read_only = off"}, true},
		{"transaction_read_only off, session, uppercase", []string{"SET SESSION TRANSACTION_READ_ONLY = OFF"}, true},
		{"transaction_read_only false", []string{"SET transaction_read_only = false"}, true},
		{"transaction_read_only zero", []string{"SET transaction_read_only = 0"}, true},
		{"tx_read_only off (mariadb spelling)", []string{"SET SESSION tx_read_only = OFF"}, true},
		{"default_transaction_read_only off", []string{"SET default_transaction_read_only = off"}, true},
		{"transaction_read_only TO off", []string{"SET transaction_read_only TO off"}, true},
		{"transaction_read_only set to on is not an escalation", []string{"SET transaction_read_only = on"}, false},
		{"default_transaction_read_only set to true is not an escalation", []string{"SET default_transaction_read_only = true"}, false},
		// A bare COMMIT/END/ROLLBACK ends the wrapping read-only transaction itself (review finding,
		// case 2): confirmed against real MariaDB and MySQL servers that `COMMIT; SET SESSION
		// tx_read_only/transaction_read_only = OFF; <write>` lets the write through once the
		// wrapper's own COMMIT has ended it — postgres was not itself vulnerable to this exact
		// sequence, but a read-only console session never has a legitimate reason to end its own
		// wrapping transaction on any engine, so this is rejected outright regardless.
		{"bare commit", []string{"COMMIT"}, true},
		{"bare commit lowercase", []string{"commit"}, true},
		{"commit work", []string{"COMMIT WORK"}, true},
		{"commit and chain", []string{"COMMIT AND CHAIN"}, true},
		{"end alias for commit", []string{"END"}, true},
		{"end transaction", []string{"END TRANSACTION"}, true},
		{"bare rollback", []string{"ROLLBACK"}, true},
		{"rollback work", []string{"ROLLBACK WORK"}, true},
		{"commit as second statement in batch", []string{"SELECT 1", "COMMIT"}, true},
		{"rollback to savepoint is not rejected", []string{"ROLLBACK TO SAVEPOINT sp1"}, false},
		{"rollback to a named savepoint without keyword", []string{"ROLLBACK TO sp1"}, false},
		{"savepoint itself is not rejected", []string{"SAVEPOINT sp1"}, false},
		{"commit mentioned mid-statement is not rejected", []string{"SELECT 'please COMMIT' AS note"}, false},
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
