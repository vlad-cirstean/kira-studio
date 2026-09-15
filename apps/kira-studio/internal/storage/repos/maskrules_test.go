package repos_test

import (
	"database/sql"
	"testing"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// M5 §8's own narrow scope for this repo: the case-insensitive unique index, ON DELETE CASCADE, and
// that InsertDuplicateWithSecret does not copy mask_correlation_key — three real correctness
// properties with a silent failure mode, not CRUD round-trips (which get nothing, per CLAUDE.md).

func newMaskRulesRepo(t *testing.T) (*repos.MaskRulesRepo, *sql.DB) {
	t.Helper()
	db := newRepos(t).DB
	return &repos.MaskRulesRepo{DB: db}, db
}

// TestMaskRulesUniqueIndexIsCaseInsensitive is plan §3.1's own stated reason the index is built on
// lower(table_name), lower(column_name): a second Upsert differing only in case must update the
// same row, never create a second one that "which wins is arbitrary" at render time.
func TestMaskRulesUniqueIndexIsCaseInsensitive(t *testing.T) {
	r, db := newMaskRulesRepo(t)
	connID := uuid.NewString()
	seedConnection(t, db, connID)
	now := model.NowISO()

	first, err := r.Upsert(uuid.NewString(), connID, model.MaskRuleFields{
		TableName: "customers", ColumnName: "email", Kind: model.MaskKindEmail, KeepHint: true, Correlate: true,
	}, now)
	if err != nil {
		t.Fatalf("Upsert(email): %v", err)
	}

	second, err := r.Upsert(uuid.NewString(), connID, model.MaskRuleFields{
		TableName: "Customers", ColumnName: "Email", Kind: model.MaskKindRedact, KeepHint: false, Correlate: false,
	}, model.NowISO())
	if err != nil {
		t.Fatalf("Upsert(Email, different case): %v", err)
	}

	if second.ID != first.ID {
		t.Fatalf("a case-differing Upsert created a second row (id %s), want it to update the existing row %s", second.ID, first.ID)
	}
	if second.Kind != model.MaskKindRedact {
		t.Fatalf("second.Kind = %s, want redact (the update should have taken)", second.Kind)
	}

	list, err := r.ListForConnection(connID)
	if err != nil {
		t.Fatalf("ListForConnection: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("ListForConnection = %d rows, want exactly 1 (case-insensitive collision must collapse to one row)", len(list))
	}
}

// TestMaskRulesCascadeOnConnectionDelete confirms connection_mask_rules(connection_id) really does
// carry ON DELETE CASCADE (the migration's own stated intent) rather than silently orphaning rows
// once a connection is removed.
func TestMaskRulesCascadeOnConnectionDelete(t *testing.T) {
	r, db := newMaskRulesRepo(t)
	connID := uuid.NewString()
	seedConnection(t, db, connID)

	if _, err := r.Upsert(uuid.NewString(), connID, model.MaskRuleFields{
		TableName: "*", ColumnName: "ssn", Kind: model.MaskKindRedact, Correlate: false,
	}, model.NowISO()); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	if _, err := db.Exec(`DELETE FROM connections WHERE id = ?`, connID); err != nil {
		t.Fatalf("delete connection: %v", err)
	}

	list, err := r.ListForConnection(connID)
	if err != nil {
		t.Fatalf("ListForConnection after delete: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("ListForConnection after connection delete = %d rows, want 0 (ON DELETE CASCADE did not fire)", len(list))
	}
}

// TestInsertDuplicateWithSecretDoesNotCopyMaskCorrelationKey is plan §3.2's own named property: a
// copied key would silently break the "key is scoped to one connection" invariant §2.5 states,
// making the duplicate's masked tags linkable back to the original's. Verified directly against
// the real ConnectionsRepo/MaskKeysRepo pair, not just read from the INSERT statement's column list.
func TestInsertDuplicateWithSecretDoesNotCopyMaskCorrelationKey(t *testing.T) {
	t.Setenv("KIRA_INSECURE_SECRETS", "1")
	db := newRepos(t).DB
	cipher := secrets.New()
	conns := &repos.ConnectionsRepo{DB: db}
	keys := repos.NewMaskKeys(db, cipher)

	fromID := uuid.NewString()
	fields := model.ConnectionFields{Name: "src", Kind: "postgres", Color: "blue", Mode: "fields"}
	if _, err := conns.InsertWithSecret(fromID, fields, model.NowISO(), nil); err != nil {
		t.Fatalf("InsertWithSecret: %v", err)
	}

	originalKey, err := keys.EnsureKey(fromID)
	if err != nil {
		t.Fatalf("EnsureKey: %v", err)
	}
	if len(originalKey) == 0 {
		t.Fatal("EnsureKey returned an empty key")
	}

	toID := uuid.NewString()
	if _, err := conns.InsertDuplicateWithSecret(fromID, toID, fields, model.NowISO()); err != nil {
		t.Fatalf("InsertDuplicateWithSecret: %v", err)
	}

	duplicateKey, err := keys.Get(toID)
	if err != nil {
		t.Fatalf("Get(duplicate): %v", err)
	}
	if duplicateKey != nil {
		t.Fatalf("duplicate connection already has a mask_correlation_key (%d bytes) — InsertDuplicateWithSecret must leave it unminted, not copy the original's", len(duplicateKey))
	}

	// A fresh EnsureKey on the duplicate must mint its OWN key, distinct from the original's — the
	// property that actually matters (linkability), not merely "the column was empty at one instant".
	duplicateMinted, err := keys.EnsureKey(toID)
	if err != nil {
		t.Fatalf("EnsureKey(duplicate): %v", err)
	}
	if string(duplicateMinted) == string(originalKey) {
		t.Fatal("the duplicate's freshly-minted key equals the original's — keys are linkable across connections")
	}
}
