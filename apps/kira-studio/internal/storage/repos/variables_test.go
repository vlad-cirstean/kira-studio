package repos_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/postman"
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
	env, err := r.CreateEnvironment("Staging", "")
	if err != nil {
		t.Fatalf("CreateEnvironment: %v", err)
	}

	var collectionIDs, envIDs []string
	for _, name := range []string{"a", "b", "c"} {
		v, err := r.Upsert(model.VariableScopeCollection, collectionID, "", name, name, false, "")
		if err != nil {
			t.Fatalf("Upsert(collection, %s): %v", name, err)
		}
		collectionIDs = append(collectionIDs, v.ID)
		w, err := r.Upsert(model.VariableScopeEnvironment, env.ID, "", name, name, false, "")
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

	v, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "baseUrl", "v1", false, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Writing the same value twice records nothing: no prior value was actually replaced.
	if _, err := r.Upsert(model.VariableScopeCollection, collectionID, v.ID, "baseUrl", "v1", false, ""); err != nil {
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
	if _, err := r.Upsert(model.VariableScopeCollection, collectionID, v.ID, "baseUrl", "v2", false, ""); err != nil {
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
	if _, err := r.Upsert(model.VariableScopeCollection, collectionID, v.ID, "baseUrl", hist[0].Value, false, ""); err != nil {
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
		if _, err := r.Upsert(model.VariableScopeCollection, collectionID, v.ID, "baseUrl", "gen"+string(rune('a'+i)), false, ""); err != nil {
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

	created, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "apiKey", "s3cr3t", true, "")
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
		`INSERT INTO api_collections (id, name, sort_order, origin_json, created_at, updated_at)
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
	if err := db.QueryRow(`SELECT variables_promoted FROM api_collections WHERE id = ?`, collectionID).Scan(&promoted); err != nil {
		t.Fatalf("read variables_promoted: %v", err)
	}
	if promoted != 1 {
		t.Fatalf("variables_promoted = %d, want 1", promoted)
	}
	var originJSON string
	if err := db.QueryRow(`SELECT origin_json FROM api_collections WHERE id = ?`, collectionID).Scan(&originJSON); err != nil {
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

// ---- 5. import → ImportVariables → LoadTree → export, end to end, secrets valueless (D15/D16) ----

func TestImportVariablesThenExportRoundTripsWithSecretsValueless(t *testing.T) {
	r, db := newVariablesRepo(t)
	cr := &repos.CollectionsRepo{DB: db}

	c, err := cr.CreateCollection("With variables")
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	vars := []postman.Variable{
		{Name: "baseUrl", Value: "https://api.example.com"},
		{Name: "apiKey", Value: "s3cr3t", Secret: true, Type: "secret"},
	}
	if err := r.ImportVariables(c.ID, vars); err != nil {
		t.Fatalf("ImportVariables: %v", err)
	}

	// The rows exist with the right names, order and secret flags, and the list projection never
	// carries the secret's plaintext (D5).
	rows, err := r.List(model.VariableScopeCollection, c.ID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("len(rows) = %d, want 2", len(rows))
	}
	if rows[0].Name != "baseUrl" || rows[0].Value != "https://api.example.com" || rows[0].IsSecret {
		t.Errorf("rows[0] = %+v", rows[0])
	}
	if rows[1].Name != "apiKey" || rows[1].Value != "" || !rows[1].IsSecret {
		t.Errorf("rows[1] = %+v", rows[1])
	}
	plain, err := r.RevealValue(rows[1].ID)
	if err != nil {
		t.Fatalf("RevealValue: %v", err)
	}
	if plain != "s3cr3t" {
		t.Errorf("RevealValue = %q, want s3cr3t", plain)
	}

	// The collection is stamped promoted — PromoteImported (List's own lazy trigger) must not
	// duplicate these rows.
	rows2, err := r.List(model.VariableScopeCollection, c.ID)
	if err != nil {
		t.Fatalf("List (again): %v", err)
	}
	if len(rows2) != 2 {
		t.Fatalf("len(rows2) = %d, want still 2", len(rows2))
	}

	// Export re-emits `variable` from the rows, in order, with the secret's value empty and its
	// type "secret" — D16, exercised through the real LoadTree -> postman.Write path.
	tree, err := cr.LoadTree(c.ID)
	if err != nil {
		t.Fatalf("LoadTree: %v", err)
	}
	var buf bytes.Buffer
	if err := postman.Write(&buf, tree); err != nil {
		t.Fatalf("Write: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(buf.Bytes(), &doc); err != nil {
		t.Fatalf("decode written file: %v", err)
	}
	written, ok := doc["variable"].([]any)
	if !ok || len(written) != 2 {
		t.Fatalf("doc[\"variable\"] = %#v, want 2 entries", doc["variable"])
	}
	want := []map[string]any{
		{"key": "baseUrl", "value": "https://api.example.com"},
		{"key": "apiKey", "value": "", "type": "secret"},
	}
	for i, row := range written {
		m, ok := row.(map[string]any)
		if !ok || len(m) != len(want[i]) {
			t.Fatalf("written[%d] = %#v, want %#v", i, row, want[i])
		}
		for k, v := range want[i] {
			if m[k] != v {
				t.Errorf("written[%d][%q] = %#v, want %#v", i, k, m[k], v)
			}
		}
	}
}

// TestSecretsForDuplicateNameResolvesFirstWinsBySortOrder is finding 2 of the round-1 review:
// mergeSecrets used to have no ORDER BY at all, leaving a duplicate name's winner undefined
// (whatever order SQLite happened to return rows in), where the documented rule (P5 D12) is
// first-wins by sort_order — the same rule mergedValuesAndSecrets (frontend/src/api/state/
// variables.ts) and findSecretVariableId (curl.ts) already implement.
func TestSecretsForDuplicateNameResolvesFirstWinsBySortOrder(t *testing.T) {
	r, db := newVariablesRepo(t)
	collectionID := newCollectionFor(t, db)

	if _, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "token", "first-value", true, ""); err != nil {
		t.Fatalf("Upsert(first): %v", err)
	}
	if _, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "token", "second-value", true, ""); err != nil {
		t.Fatalf("Upsert(second): %v", err)
	}

	secrets, err := r.SecretsFor(collectionID, "")
	if err != nil {
		t.Fatalf("SecretsFor: %v", err)
	}
	if got := secrets["token"]; got != "first-value" {
		t.Fatalf("SecretsFor()[\"token\"] = %q, want %q (first-wins by sort_order)", got, "first-value")
	}
}

// TestSecretsForEnvironmentStillOverridesCollectionDespiteFirstWins guards the interaction finding
// 2's fix has to respect: first-wins applies *within* a scope, never across scopes — an
// environment-scope variable must still override a same-named collection-scope one (D2), even
// though mergeSecrets now skips a later same-named row within either individual scope's own query.
func TestSecretsForEnvironmentStillOverridesCollectionDespiteFirstWins(t *testing.T) {
	r, db := newVariablesRepo(t)
	collectionID := newCollectionFor(t, db)
	env, err := r.CreateEnvironment("Staging", "")
	if err != nil {
		t.Fatalf("CreateEnvironment: %v", err)
	}

	if _, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "token", "collection-value", true, ""); err != nil {
		t.Fatalf("Upsert(collection): %v", err)
	}
	if _, err := r.Upsert(model.VariableScopeEnvironment, env.ID, "", "token", "env-value", true, ""); err != nil {
		t.Fatalf("Upsert(environment): %v", err)
	}

	secrets, err := r.SecretsFor(collectionID, env.ID)
	if err != nil {
		t.Fatalf("SecretsFor: %v", err)
	}
	if got := secrets["token"]; got != "env-value" {
		t.Fatalf("SecretsFor()[\"token\"] = %q, want %q (environment overrides collection)", got, "env-value")
	}
}

// ---- 5. DuplicateEnvironment (P17 D17): a raw-ciphertext copy, no history, never active ----

func TestDuplicateEnvironmentCopiesCiphertextVerbatimNoHistoryNeverActive(t *testing.T) {
	r, db := newVariablesRepo(t)

	env, err := r.CreateEnvironment("Staging", "a description")
	if err != nil {
		t.Fatalf("CreateEnvironment: %v", err)
	}
	if err := r.SetActiveEnvironment(env.ID); err != nil {
		t.Fatalf("SetActiveEnvironment: %v", err)
	}
	plain, err := r.Upsert(model.VariableScopeEnvironment, env.ID, "", "apiKey", "s3cr3t-value", true, "")
	if err != nil {
		t.Fatalf("Upsert(secret): %v", err)
	}
	// A second, real edit so the source variable actually has history — proving the clone
	// carries none of it is meaningless against a variable that never had any.
	if _, err := r.Upsert(model.VariableScopeEnvironment, env.ID, plain.ID, "apiKey", "s3cr3t-value-2", true, ""); err != nil {
		t.Fatalf("Upsert(secret, changed): %v", err)
	}
	srcHistory, err := r.History(plain.ID)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(srcHistory) == 0 {
		t.Fatal("source variable has no history — this fixture doesn't exercise the guard")
	}

	dup, err := r.DuplicateEnvironment(env.ID)
	if err != nil {
		t.Fatalf("DuplicateEnvironment: %v", err)
	}
	if dup.Name != "Staging copy" {
		t.Errorf("dup.Name = %q, want %q", dup.Name, "Staging copy")
	}
	if dup.Description != "a description" {
		t.Errorf("dup.Description = %q, want copied from source", dup.Description)
	}
	if dup.IsActive {
		t.Error("dup.IsActive = true, want false even though the source is active (D3)")
	}

	// The source environment must remain the active one — duplicating must not steal the
	// selection or create a second active row.
	envs, err := r.ListEnvironments()
	if err != nil {
		t.Fatalf("ListEnvironments: %v", err)
	}
	activeCount := 0
	for _, e := range envs {
		if e.IsActive {
			activeCount++
			if e.ID != env.ID {
				t.Errorf("active environment = %s, want the original %s", e.ID, env.ID)
			}
		}
	}
	if activeCount != 1 {
		t.Fatalf("active environment count = %d, want exactly 1", activeCount)
	}

	dupVars, err := r.List(model.VariableScopeEnvironment, dup.ID)
	if err != nil {
		t.Fatalf("List(dup): %v", err)
	}
	if len(dupVars) != 1 || dupVars[0].Name != "apiKey" || !dupVars[0].IsSecret {
		t.Fatalf("dupVars = %+v, want one secret row named apiKey", dupVars)
	}
	if dupVars[0].ID == plain.ID {
		t.Fatal("the duplicated variable shares the source's own id")
	}

	// The property that matters: the copy's secret_value column is byte-identical to the
	// source's — a raw column copy, never a decrypt/re-encrypt (which would produce a different
	// ciphertext even for the same plaintext, since AES-GCM uses a fresh nonce per encryption).
	var srcCipher, dupCipher string
	if err := db.QueryRow(`SELECT secret_value FROM api_variables WHERE name = 'apiKey' AND environment_id = ?`, env.ID).Scan(&srcCipher); err != nil {
		t.Fatalf("read source ciphertext: %v", err)
	}
	if err := db.QueryRow(`SELECT secret_value FROM api_variables WHERE name = 'apiKey' AND environment_id = ?`, dup.ID).Scan(&dupCipher); err != nil {
		t.Fatalf("read duplicate ciphertext: %v", err)
	}
	if srcCipher != dupCipher {
		t.Fatalf("ciphertext changed across the duplicate — source %q, copy %q (expected byte-identical)", srcCipher, dupCipher)
	}
	// Both still decrypt to the same plaintext (sanity: the byte-identical ciphertext is not
	// simply empty or garbage).
	revealed, err := r.RevealValue(dupVars[0].ID)
	if err != nil {
		t.Fatalf("RevealValue(dup): %v", err)
	}
	if revealed != "s3cr3t-value-2" {
		t.Fatalf("RevealValue(dup) = %q, want %q", revealed, "s3cr3t-value-2")
	}

	// No history rows copied — the clone's row has none, even though the source (the same name,
	// a distinct id) does.
	dupHistory, err := r.History(dupVars[0].ID)
	if err != nil {
		t.Fatalf("History(dup): %v", err)
	}
	if len(dupHistory) != 0 {
		t.Fatalf("History(dup) = %+v, want none copied", dupHistory)
	}
}

// ---- 6. ApplyBulk (P17 D22/D23): the two properties that matter most ----

func TestApplyBulkLeavesAnUntouchedSecretByteIdentical(t *testing.T) {
	r, db := newVariablesRepo(t)
	collectionID := newCollectionFor(t, db)

	created, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "apiKey", "s3cr3t", true, "d")
	if err != nil {
		t.Fatalf("Upsert(secret): %v", err)
	}
	var before string
	if err := db.QueryRow(`SELECT secret_value FROM api_variables WHERE id = ?`, created.ID).Scan(&before); err != nil {
		t.Fatalf("read secret_value before: %v", err)
	}

	// The bulk editor's own "untouched" shape: a bare `KEY=` line, HasValue: false, same
	// description — the property that makes it safe to open the editor and press Apply without
	// re-typing every secret.
	result, err := r.ApplyBulk(model.VariableScopeCollection, collectionID, []model.VariableBulkEntry{
		{Name: "apiKey", Value: "", HasValue: false, Description: "d"},
	})
	if err != nil {
		t.Fatalf("ApplyBulk: %v", err)
	}
	if result.Added != 0 || result.Updated != 0 || result.Removed != 0 || result.Reordered {
		t.Fatalf("result = %+v, want an untouched no-op", result)
	}

	var after string
	if err := db.QueryRow(`SELECT secret_value FROM api_variables WHERE id = ?`, created.ID).Scan(&after); err != nil {
		t.Fatalf("read secret_value after: %v", err)
	}
	if before != after {
		t.Fatalf("secret_value changed across an untouched ApplyBulk: before %q, after %q", before, after)
	}

	rows, err := r.List(model.VariableScopeCollection, collectionID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rows) != 1 || !rows[0].IsSecret {
		t.Fatalf("rows = %+v, want the one secret row intact", rows)
	}
}

func TestApplyBulkNewSecretValueRecordsExactlyOneHistoryRow(t *testing.T) {
	r, db := newVariablesRepo(t)
	collectionID := newCollectionFor(t, db)

	created, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "apiKey", "old-secret", true, "")
	if err != nil {
		t.Fatalf("Upsert(secret): %v", err)
	}

	result, err := r.ApplyBulk(model.VariableScopeCollection, collectionID, []model.VariableBulkEntry{
		{Name: "apiKey", Value: "new-secret", HasValue: true, Description: ""},
	})
	if err != nil {
		t.Fatalf("ApplyBulk: %v", err)
	}
	if result.Updated != 1 || result.Added != 0 || result.Removed != 0 {
		t.Fatalf("result = %+v, want exactly one update", result)
	}

	hist, err := r.History(created.ID)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(hist) != 1 || !hist[0].IsSecret {
		t.Fatalf("hist = %+v, want exactly one secret history row (the value it replaced)", hist)
	}
	revealed, err := r.RevealValue(created.ID)
	if err != nil {
		t.Fatalf("RevealValue: %v", err)
	}
	if revealed != "new-secret" {
		t.Fatalf("RevealValue = %q, want %q", revealed, "new-secret")
	}
}

// TestApplyBulkFullReconcile exercises every D22 rule in one transaction: an update, a create
// (new, non-secret), a delete, and a description-only change on a secret whose value line was
// left untouched.
func TestApplyBulkFullReconcile(t *testing.T) {
	r, db := newVariablesRepo(t)
	collectionID := newCollectionFor(t, db)

	kept, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "kept", "old-value", false, "")
	if err != nil {
		t.Fatalf("Upsert(kept): %v", err)
	}
	gone, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "gone", "x", false, "")
	if err != nil {
		t.Fatalf("Upsert(gone): %v", err)
	}
	secret, err := r.Upsert(model.VariableScopeCollection, collectionID, "", "secretVar", "s3cr3t", true, "old desc")
	if err != nil {
		t.Fatalf("Upsert(secretVar): %v", err)
	}

	result, err := r.ApplyBulk(model.VariableScopeCollection, collectionID, []model.VariableBulkEntry{
		{Name: "kept", Value: "new-value", HasValue: true, Description: ""},
		{Name: "secretVar", Value: "", HasValue: false, Description: "new desc"},
		{Name: "brandNew", Value: "v", HasValue: true, Description: ""},
	})
	if err != nil {
		t.Fatalf("ApplyBulk: %v", err)
	}
	if result.Added != 1 || result.Updated != 2 || result.Removed != 1 {
		t.Fatalf("result = %+v, want {Added:1 Updated:2 Removed:1}", result)
	}

	rows, err := r.List(model.VariableScopeCollection, collectionID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	byName := map[string]model.Variable{}
	for _, row := range rows {
		byName[row.Name] = row
	}
	if len(rows) != 3 {
		t.Fatalf("rows = %+v, want exactly 3 (kept, secretVar, brandNew — gone removed)", rows)
	}
	if v, ok := byName["kept"]; !ok || v.Value != "new-value" || v.ID != kept.ID {
		t.Errorf("kept = %+v, want value updated with the same id", v)
	}
	if _, ok := byName["gone"]; ok {
		t.Error("gone still present, want removed")
	}
	if v, ok := byName["secretVar"]; !ok || v.ID != secret.ID || v.Description != "new desc" {
		t.Errorf("secretVar = %+v, want description updated, same id, value still masked", v)
	}
	if v, ok := byName["brandNew"]; !ok || v.IsSecret {
		t.Errorf("brandNew = %+v, want a new non-secret row", v)
	}

	// The removed row's history is gone too (cascade, same as Delete).
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM api_variable_history WHERE variable_id = ?`, gone.ID).Scan(&count); err != nil {
		t.Fatalf("count history: %v", err)
	}
	if count != 0 {
		t.Errorf("history rows for the removed variable = %d, want 0 (cascaded)", count)
	}
}
