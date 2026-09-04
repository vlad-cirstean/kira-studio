package repos_test

import (
	"database/sql"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// P5 §6.2: four cases, each guarding arithmetic or an invariant rather than a CRUD round-trip —
// that CreateEnvironment then ListEnvironments returns it, that RenameEnvironment renames, that a
// missing name is refused, that the cipher round-trips a string: each is AGENTS.md's "everything
// else gets nothing".

// newVariablesRepo mirrors newCollectionsRepo's shape: a real migrated database, plus the real
// secrets.Cipher under the Linux KIRA_INSECURE_SECRETS fallback (connections/service_test.go's own
// precedent) — a genuine encrypt/decrypt round trip, not a fake.
func newVariablesRepo(t *testing.T) (*repos.VariablesRepo, *sql.DB) {
	t.Helper()
	t.Setenv("KIRA_INSECURE_SECRETS", "1")
	db := newRepos(t).DB
	cipher := secrets.New()
	return repos.NewVariables(db, cipher), db
}

func newCollectionFor(t *testing.T, db *sql.DB) string {
	t.Helper()
	c, err := (&repos.CollectionsRepo{DB: db}).CreateCollection("Orders")
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	return c.ID
}

// ---- 1. sort_order is dense and stable, per scope, independently ----

func TestVariablesSortOrderIsDenseAndScopeIndependent(t *testing.T) {
	r, db := newVariablesRepo(t)
	collectionID := newCollectionFor(t, db)
	env, err := r.CreateEnvironment("Staging")
	if err != nil {
		t.Fatalf("CreateEnvironment: %v", err)
	}

	var collectionIDs, envIDs []string
	for _, name := range []string{"a", "b", "c"} {
		v, err := r.Upsert(model.VariableScopeCollection, collectionID, "", name, name, false)
		if err != nil {
			t.Fatalf("Upsert(collection, %s): %v", name, err)
		}
		collectionIDs = append(collectionIDs, v.ID)
		w, err := r.Upsert(model.VariableScopeEnvironment, env.ID, "", name, name, false)
		if err != nil {
			t.Fatalf("Upsert(environment, %s): %v", name, err)
		}
		envIDs = append(envIDs, w.ID)
	}

	// Delete the middle collection variable — its siblings must re-index dense, and the
	// environment's own list must be completely unaffected (a collection's reorder must not
	// renumber an environment's, D4's own comment).
	if err := r.Delete(collectionIDs[1]); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	remaining, err := r.List(model.VariableScopeCollection, collectionID)
	if err != nil {
		t.Fatalf("List(collection): %v", err)
	}
	if len(remaining) != 2 {
		t.Fatalf("len(remaining) = %d, want 2", len(remaining))
	}
	for i, v := range remaining {
		if v.SortOrder != i {
			t.Errorf("remaining[%d].SortOrder = %d, want %d (dense)", i, v.SortOrder, i)
		}
	}

	envVars, err := r.List(model.VariableScopeEnvironment, env.ID)
	if err != nil {
		t.Fatalf("List(environment): %v", err)
	}
	if len(envVars) != 3 {
		t.Fatalf("len(envVars) = %d, want 3 (unaffected by the collection's delete)", len(envVars))
	}
	for i, v := range envVars {
		if v.SortOrder != i {
			t.Errorf("envVars[%d].SortOrder = %d, want %d", i, v.SortOrder, i)
		}
	}

	// Reorder the environment's own three (independent of the collection again).
	reordered := []string{envIDs[2], envIDs[0], envIDs[1]}
	if err := r.Reorder(model.VariableScopeEnvironment, env.ID, reordered); err != nil {
		t.Fatalf("Reorder: %v", err)
	}
	after, err := r.List(model.VariableScopeEnvironment, env.ID)
	if err != nil {
		t.Fatalf("List(environment) after reorder: %v", err)
	}
	for i, id := range reordered {
		if after[i].ID != id || after[i].SortOrder != i {
			t.Errorf("after[%d] = %+v, want id %s at sortOrder %d", i, after[i], id, i)
		}
	}
}

// ---- 2. history: recorded on change only, deduped, trimmed at 20 ----

func TestVariableHistoryRecordsOnChangeDedupedAndTrimmed(t *testing.T) {
	r, db := newVariablesRepo(t)
	collectionID := newCollectionFor(t, db)

	v, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "baseUrl", "v1", false)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Writing the same value twice records nothing: no prior value was actually replaced.
	if _, err := r.Upsert(model.VariableScopeCollection, collectionID, v.ID, "baseUrl", "v1", false); err != nil {
		t.Fatalf("no-op upsert: %v", err)
	}
	hist, err := r.History(v.ID)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(hist) != 0 {
		t.Fatalf("len(hist) after an unchanged write = %d, want 0", len(hist))
	}

	// A real change records the value it replaced.
	if _, err := r.Upsert(model.VariableScopeCollection, collectionID, v.ID, "baseUrl", "v2", false); err != nil {
		t.Fatalf("upsert v2: %v", err)
	}
	hist, err = r.History(v.ID)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(hist) != 1 || hist[0].Value != "v1" {
		t.Fatalf("hist = %+v, want one entry carrying v1", hist)
	}

	// Restoring writes through the ordinary path, so it is itself recorded — the value being
	// replaced (v2) becomes the newest history entry.
	if _, err := r.Upsert(model.VariableScopeCollection, collectionID, v.ID, "baseUrl", hist[0].Value, false); err != nil {
		t.Fatalf("restore: %v", err)
	}
	hist, err = r.History(v.ID)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(hist) != 2 || hist[0].Value != "v2" {
		t.Fatalf("hist after restore = %+v, want newest v2", hist)
	}

	// Trimmed at 20, oldest dropped first.
	for i := 0; i < 25; i++ {
		if _, err := r.Upsert(model.VariableScopeCollection, collectionID, v.ID, "baseUrl", "gen"+string(rune('a'+i)), false); err != nil {
			t.Fatalf("upsert gen%d: %v", i, err)
		}
	}
	hist, err = r.History(v.ID)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(hist) != 20 {
		t.Fatalf("len(hist) after 25 more changes = %d, want 20 (trimmed)", len(hist))
	}
	// hist[0] is the value *replaced* by the very last write (i=24, "geny"), i.e. i=23's "genx" —
	// history records what a change overwrote, not the change itself.
	if want := "gen" + string(rune('a'+23)); hist[0].Value != want {
		t.Errorf("hist[0].Value = %q, want %q", hist[0].Value, want)
	}
}

// ---- 3. List never returns a secret's plaintext or ciphertext ----

func TestVariablesListNeverReturnsASecret(t *testing.T) {
	r, db := newVariablesRepo(t)
	collectionID := newCollectionFor(t, db)

	created, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "apiKey", "s3cr3t", true)
	if err != nil {
		t.Fatalf("Upsert(secret): %v", err)
	}
	if created.Value != "" {
		t.Fatalf("Upsert's own returned Value = %q, want '' for a secret", created.Value)
	}

	rows, err := r.List(model.VariableScopeCollection, collectionID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rows) != 1 || rows[0].Value != "" || !rows[0].IsSecret {
		t.Fatalf("List row = %+v, want value '' and isSecret true", rows)
	}

	plain, err := r.RevealValue(created.ID)
	if err != nil {
		t.Fatalf("RevealValue: %v", err)
	}
	if plain != "s3cr3t" {
		t.Errorf("RevealValue = %q, want s3cr3t", plain)
	}
}

// ---- 4. PromoteImported is one-shot and idempotent ----

func TestPromoteImportedIsOneShotAndIdempotent(t *testing.T) {
	r, db := newVariablesRepo(t)

	// A pre-P5 collection row: created directly, carrying a top-level variable[] inside
	// origin_json exactly as a P4-era import would have left it.
	now := model.NowISO()
	collectionID := "collection-pre-p5"
	if _, err := db.Exec(
		`INSERT INTO http_collections (id, name, sort_order, origin_json, created_at, updated_at)
		 VALUES (?, 'Legacy', 0, ?, ?, ?)`,
		collectionID,
		`{"variable":[{"key":"baseUrl","value":"https://api.example.com"},{"key":"apiKey","value":"","type":"secret"}]}`,
		now, now,
	); err != nil {
		t.Fatalf("seed pre-P5 collection: %v", err)
	}

	rows, err := r.List(model.VariableScopeCollection, collectionID)
	if err != nil {
		t.Fatalf("List (triggers promotion): %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("len(rows) after promotion = %d, want 2", len(rows))
	}

	var promoted int
	if err := db.QueryRow(`SELECT variables_promoted FROM http_collections WHERE id = ?`, collectionID).Scan(&promoted); err != nil {
		t.Fatalf("read variables_promoted: %v", err)
	}
	if promoted != 1 {
		t.Fatalf("variables_promoted = %d, want 1", promoted)
	}
	var originJSON string
	if err := db.QueryRow(`SELECT origin_json FROM http_collections WHERE id = ?`, collectionID).Scan(&originJSON); err != nil {
		t.Fatalf("read origin_json: %v", err)
	}
	if originJSON != `{}` {
		t.Errorf("origin_json = %q, want the variable member shed to '{}'", originJSON)
	}

	// A second call — via PromoteImported directly this time — changes nothing.
	if err := r.PromoteImported(collectionID); err != nil {
		t.Fatalf("PromoteImported (second call): %v", err)
	}
	rowsAgain, err := r.List(model.VariableScopeCollection, collectionID)
	if err != nil {
		t.Fatalf("List (second call): %v", err)
	}
	if len(rowsAgain) != 2 {
		t.Fatalf("len(rowsAgain) = %d, want still 2 (idempotent, no duplicate rows)", len(rowsAgain))
	}
}
