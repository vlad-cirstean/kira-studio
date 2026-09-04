package repos

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// variableHistoryLimit mirrors historyLimit (filter_history.go) — the same bound, applied to a
// different table (P5 D13).
const variableHistoryLimit = 20

// VariablesRepo owns three tables (P5 D4): http_environments, http_variables and
// http_variable_history. One repo for both scopes (collection and environment), not two: a
// collection variable and an environment variable share every field, every secret rule, the same
// history table and the same dense-sort_order arithmetic — the asymmetry that split
// http_collections from http_items (P4 D2) does not exist here.
//
// No prepared statement: these queries run on dialog open/edit, not per keystroke (mirrors
// CollectionsRepo's own reasoning).
type VariablesRepo struct {
	db     *sql.DB
	cipher Cipher
}

// NewVariables mirrors NewSecrets: constructed separately from repos.New's aggregate (not because
// the cipher is unavailable at that point — it already exists by then — but to keep the same
// "a repo that touches secret_value takes its Cipher explicitly, at its own call site" shape
// repos/secrets.go established, rather than widening repos.New's own signature for one repo among
// many that do not need it).
func NewVariables(db *sql.DB, cipher Cipher) *VariablesRepo {
	return &VariablesRepo{db: db, cipher: cipher}
}

// ---- environments (D3) ----

func (r *VariablesRepo) ListEnvironments() ([]model.Environment, error) {
	rows, err := r.db.Query(`SELECT id, name, sort_order, is_active FROM http_environments ORDER BY sort_order, name`)
	if err != nil {
		return nil, fmt.Errorf("repos/variables: list environments: %w", err)
	}
	defer rows.Close()

	out := []model.Environment{}
	for rows.Next() {
		var (
			e        model.Environment
			isActive int
		)
		if err := rows.Scan(&e.ID, &e.Name, &e.SortOrder, &isActive); err != nil {
			return nil, fmt.Errorf("repos/variables: scan environment: %w", err)
		}
		e.IsActive = isActive != 0
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/variables: environment rows: %w", err)
	}
	return out, nil
}

func (r *VariablesRepo) CreateEnvironment(name string) (model.Environment, error) {
	if name == "" {
		return model.Environment{}, fmt.Errorf("repos/variables: name is required")
	}
	var order int
	if err := r.db.QueryRow(`SELECT COALESCE(MAX(sort_order) + 1, 0) FROM http_environments`).Scan(&order); err != nil {
		return model.Environment{}, fmt.Errorf("repos/variables: next environment order: %w", err)
	}
	now := model.NowISO()
	e := model.Environment{ID: uuid.NewString(), Name: name, SortOrder: order}
	if _, err := r.db.Exec(
		`INSERT INTO http_environments (id, name, sort_order, is_active, created_at, updated_at)
		 VALUES (?, ?, ?, 0, ?, ?)`,
		e.ID, e.Name, e.SortOrder, now, now,
	); err != nil {
		return model.Environment{}, fmt.Errorf("repos/variables: insert environment: %w", err)
	}
	return e, nil
}

func (r *VariablesRepo) RenameEnvironment(id, name string) error {
	if id == "" || name == "" {
		return fmt.Errorf("repos/variables: id and name are required")
	}
	res, err := r.db.Exec(`UPDATE http_environments SET name = ?, updated_at = ? WHERE id = ?`, name, model.NowISO(), id)
	if err != nil {
		return fmt.Errorf("repos/variables: rename environment %s: %w", id, err)
	}
	return requireOneRow(res, "environment", id)
}

// DeleteEnvironment cascades its variables and their history (ON DELETE CASCADE, D4). Deleting the
// active environment simply leaves none active (D3) — there is nothing further to reassign.
func (r *VariablesRepo) DeleteEnvironment(id string) error {
	if id == "" {
		return fmt.Errorf("repos/variables: id is required")
	}
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("repos/variables: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.Exec(`DELETE FROM http_environments WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("repos/variables: delete environment %s: %w", id, err)
	}
	if err := requireOneRow(res, "environment", id); err != nil {
		return err
	}
	if err := reindexEnvironments(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/variables: commit: %w", err)
	}
	return nil
}

// SetActiveEnvironment enforces D3's invariant — at most one active row — in one transaction.
// id == "" selects "No environment": the first statement alone.
func (r *VariablesRepo) SetActiveEnvironment(id string) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("repos/variables: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`UPDATE http_environments SET is_active = 0`); err != nil {
		return fmt.Errorf("repos/variables: clear active environment: %w", err)
	}
	if id != "" {
		res, err := tx.Exec(`UPDATE http_environments SET is_active = 1, updated_at = ? WHERE id = ?`, model.NowISO(), id)
		if err != nil {
			return fmt.Errorf("repos/variables: set active environment %s: %w", id, err)
		}
		if err := requireOneRow(res, "environment", id); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/variables: commit: %w", err)
	}
	return nil
}

func (r *VariablesRepo) ReorderEnvironments(ids []string) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("repos/variables: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for order, id := range ids {
		if _, err := tx.Exec(`UPDATE http_environments SET sort_order = ? WHERE id = ?`, order, id); err != nil {
			return fmt.Errorf("repos/variables: reorder environment %s: %w", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/variables: commit: %w", err)
	}
	return nil
}

// reindexEnvironments rewrites every environment's sort_order dense, 0..n-1, in the order the rows
// already have — CollectionsRepo.reindexSiblings' own discipline (P4 D2), applied to a table with
// no parent to scope by.
func reindexEnvironments(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT id FROM http_environments ORDER BY sort_order, created_at, id`)
	if err != nil {
		return fmt.Errorf("repos/variables: read environments: %w", err)
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("repos/variables: scan environment: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("repos/variables: environment rows: %w", err)
	}
	rows.Close()
	for order, id := range ids {
		if _, err := tx.Exec(`UPDATE http_environments SET sort_order = ? WHERE id = ?`, order, id); err != nil {
			return fmt.Errorf("repos/variables: reindex environment %s: %w", id, err)
		}
	}
	return nil
}

// ---- variables (D4/D5/D12) ----

func scopeColumn(scope model.VariableScope) (string, error) {
	switch scope {
	case model.VariableScopeCollection:
		return "collection_id", nil
	case model.VariableScopeEnvironment:
		return "environment_id", nil
	}
	return "", fmt.Errorf("repos/variables: unrecognised scope %q", scope)
}

// List returns one scope's variables, ordered dense by sort_order. Never selects secret_value —
// D4/D5's whole security property is a fact about this SQL projection, not a Go branch. A
// collection's own list is promoted first (D15/F5), one-shot, if it has not been already.
func (r *VariablesRepo) List(scope model.VariableScope, ownerID string) ([]model.Variable, error) {
	column, err := scopeColumn(scope)
	if err != nil {
		return nil, err
	}
	if ownerID == "" {
		return nil, fmt.Errorf("repos/variables: ownerId is required")
	}
	if scope == model.VariableScopeCollection {
		if err := r.promoteIfNeeded(ownerID); err != nil {
			// F5/D15: a promotion failure must not make the list itself unreadable — it is
			// retried on the next List, and the collection's own variables (if any were already
			// promoted) still read correctly.
			slog.Warn("promoting a pre-P5 collection's variable[] failed", "scope", "storage/variables", "collectionId", ownerID, "err", err)
		}
	}

	rows, err := r.db.Query(
		`SELECT id, name, value, is_secret, sort_order FROM http_variables
		  WHERE `+column+` = ? ORDER BY sort_order, name`,
		ownerID,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/variables: query %s: %w", scope, err)
	}
	defer rows.Close()

	out := []model.Variable{}
	for rows.Next() {
		v := model.Variable{Scope: scope, OwnerID: ownerID}
		var isSecret int
		if err := rows.Scan(&v.ID, &v.Name, &v.Value, &isSecret, &v.SortOrder); err != nil {
			return nil, fmt.Errorf("repos/variables: scan variable: %w", err)
		}
		v.IsSecret = isSecret != 0
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/variables: variable rows: %w", err)
	}
	return out, nil
}

// Upsert creates (id == "") or updates one variable. value is always the plaintext — a secret's
// plaintext crosses the bridge here deliberately, in the one direction D5 never restricts: the
// user just typed it into a revealed, editable field, the same as ConnectionDialog's password
// field. D13: an update that actually changes the stored value records the value it replaced,
// inside the same transaction, before trimming to variableHistoryLimit.
func (r *VariablesRepo) Upsert(scope model.VariableScope, ownerID, id, name, value string, isSecret bool) (model.Variable, error) {
	if _, err := scopeColumn(scope); err != nil {
		return model.Variable{}, err
	}
	if err := (model.Variable{Name: name}).Validate(); err != nil {
		return model.Variable{}, err
	}

	storedValue, storedSecret, err := r.encryptFor(value, isSecret)
	if err != nil {
		return model.Variable{}, err
	}

	tx, err := r.db.Begin()
	if err != nil {
		return model.Variable{}, fmt.Errorf("repos/variables: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	now := model.NowISO()
	if id == "" {
		if ownerID == "" {
			return model.Variable{}, fmt.Errorf("repos/variables: ownerId is required")
		}
		var order int
		if err := tx.QueryRow(`SELECT COALESCE(MAX(sort_order) + 1, 0) FROM http_variables WHERE `+mustScopeColumn(scope)+` = ?`, ownerID).Scan(&order); err != nil {
			return model.Variable{}, fmt.Errorf("repos/variables: next variable order: %w", err)
		}
		v := model.Variable{ID: uuid.NewString(), Scope: scope, OwnerID: ownerID, Name: name, Value: value, IsSecret: isSecret, SortOrder: order}
		var collectionID, environmentID *string
		if scope == model.VariableScopeCollection {
			collectionID = &ownerID
		} else {
			environmentID = &ownerID
		}
		if _, err := tx.Exec(
			`INSERT INTO http_variables (id, collection_id, environment_id, name, value, is_secret, secret_value, sort_order, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			v.ID, collectionID, environmentID, v.Name, storedValue, boolToInt(v.IsSecret), storedSecret, v.SortOrder, now, now,
		); err != nil {
			return model.Variable{}, fmt.Errorf("repos/variables: insert variable: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return model.Variable{}, fmt.Errorf("repos/variables: commit: %w", err)
		}
		// value in the returned struct follows List's own convention: '' for a secret.
		if v.IsSecret {
			v.Value = ""
		}
		return v, nil
	}

	var (
		collectionID, environmentID sql.NullString
		oldValue                    string
		oldSecretInt                int
		oldSecretValue              sql.NullString
		oldSortOrder                int
	)
	err = tx.QueryRow(
		`SELECT collection_id, environment_id, value, is_secret, secret_value, sort_order FROM http_variables WHERE id = ?`, id,
	).Scan(&collectionID, &environmentID, &oldValue, &oldSecretInt, &oldSecretValue, &oldSortOrder)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Variable{}, fmt.Errorf("repos/variables: no variable %s", id)
	}
	if err != nil {
		return model.Variable{}, fmt.Errorf("repos/variables: read variable %s: %w", id, err)
	}
	oldSecret := oldSecretInt != 0

	if changed, oldPlain, oldPlainOK := r.valueChanged(oldValue, oldSecret, oldSecretValue, value); changed && oldPlainOK {
		if err := r.recordHistory(tx, id, oldPlain, oldSecret, oldSecretValue, now); err != nil {
			return model.Variable{}, err
		}
	}

	if _, err := tx.Exec(
		`UPDATE http_variables SET name = ?, value = ?, is_secret = ?, secret_value = ?, updated_at = ? WHERE id = ?`,
		name, storedValue, boolToInt(isSecret), storedSecret, now, id,
	); err != nil {
		return model.Variable{}, fmt.Errorf("repos/variables: update variable %s: %w", id, err)
	}

	resolvedScope, resolvedOwner := model.VariableScopeCollection, ""
	if collectionID.Valid {
		resolvedOwner = collectionID.String
	} else {
		resolvedScope, resolvedOwner = model.VariableScopeEnvironment, environmentID.String
	}

	if err := tx.Commit(); err != nil {
		return model.Variable{}, fmt.Errorf("repos/variables: commit: %w", err)
	}

	out := model.Variable{ID: id, Scope: resolvedScope, OwnerID: resolvedOwner, Name: name, Value: value, IsSecret: isSecret, SortOrder: oldSortOrder}
	if out.IsSecret {
		out.Value = ""
	}
	return out, nil
}

func mustScopeColumn(scope model.VariableScope) string {
	c, _ := scopeColumn(scope)
	return c
}

// encryptFor turns a plaintext into the pair of columns http_variables actually stores (D4's
// CHECK: exactly one of value/secret_value is populated).
func (r *VariablesRepo) encryptFor(value string, isSecret bool) (storedValue string, storedSecret *string, err error) {
	if !isSecret {
		return value, nil, nil
	}
	encrypted, err := r.cipher.Encrypt(value)
	if err != nil {
		return "", nil, fmt.Errorf("repos/variables: encrypt: %w", err)
	}
	return "", &encrypted, nil
}

// valueChanged decrypts the stored old value (if secret) once and compares plaintext — D13:
// comparing ciphertext directly is meaningless, since GCM nonces differ per encryption. A decrypt
// failure (a keychain reset, a database copied from another machine) is reported and treated as
// "cannot tell", so no history entry is recorded for it — recording garbage would only compound the
// original problem, and the edit itself must not be blocked by an old value nobody can read any
// more.
func (r *VariablesRepo) valueChanged(oldValue string, oldSecret bool, oldSecretValue sql.NullString, newValue string) (changed bool, oldPlain string, ok bool) {
	if !oldSecret {
		return oldValue != newValue, oldValue, true
	}
	if !oldSecretValue.Valid {
		return false, "", false
	}
	plain, err := r.cipher.Decrypt(oldSecretValue.String)
	if err != nil {
		slog.Warn("could not decrypt a variable's prior value while checking for a change", "scope", "storage/variables", "err", err)
		return false, "", false
	}
	return plain != newValue, plain, true
}

// recordHistory writes the value being replaced, then trims to variableHistoryLimit — the same
// "insert, then DELETE … WHERE id NOT IN (SELECT … ORDER BY … LIMIT ?)" shape
// filter_history.go's Record already uses (D13).
func (r *VariablesRepo) recordHistory(tx *sql.Tx, variableID, oldPlain string, oldSecret bool, oldSecretValue sql.NullString, now string) error {
	value := oldPlain
	var secretValue *string
	if oldSecret {
		value = ""
		if oldSecretValue.Valid {
			secretValue = &oldSecretValue.String
		}
	}
	if _, err := tx.Exec(
		`INSERT INTO http_variable_history (id, variable_id, value, is_secret, secret_value, recorded_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		uuid.NewString(), variableID, value, boolToInt(oldSecret), secretValue, now,
	); err != nil {
		return fmt.Errorf("repos/variables: insert history: %w", err)
	}
	if _, err := tx.Exec(`
		DELETE FROM http_variable_history
		 WHERE variable_id = ?
		   AND id NOT IN (
		     SELECT id FROM http_variable_history
		      WHERE variable_id = ?
		      ORDER BY recorded_at DESC, rowid DESC
		      LIMIT ?
		   )
	`, variableID, variableID, variableHistoryLimit); err != nil {
		return fmt.Errorf("repos/variables: trim history: %w", err)
	}
	return nil
}

// Delete removes one variable (and its history, cascaded) and re-indexes its surviving siblings
// dense — CollectionsRepo.Delete's own discipline (P4).
func (r *VariablesRepo) Delete(id string) error {
	if id == "" {
		return fmt.Errorf("repos/variables: id is required")
	}
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("repos/variables: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var collectionID, environmentID sql.NullString
	err = tx.QueryRow(`SELECT collection_id, environment_id FROM http_variables WHERE id = ?`, id).Scan(&collectionID, &environmentID)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("repos/variables: no variable %s", id)
	}
	if err != nil {
		return fmt.Errorf("repos/variables: read variable %s: %w", id, err)
	}

	res, err := tx.Exec(`DELETE FROM http_variables WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("repos/variables: delete variable %s: %w", id, err)
	}
	if err := requireOneRow(res, "variable", id); err != nil {
		return err
	}

	scope, ownerID := model.VariableScopeCollection, collectionID.String
	if !collectionID.Valid {
		scope, ownerID = model.VariableScopeEnvironment, environmentID.String
	}
	if err := reindexVariables(tx, scope, ownerID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/variables: commit: %w", err)
	}
	return nil
}

func reindexVariables(tx *sql.Tx, scope model.VariableScope, ownerID string) error {
	column, err := scopeColumn(scope)
	if err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT id FROM http_variables WHERE `+column+` = ? ORDER BY sort_order, created_at, id`, ownerID)
	if err != nil {
		return fmt.Errorf("repos/variables: read siblings: %w", err)
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("repos/variables: scan sibling: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("repos/variables: sibling rows: %w", err)
	}
	rows.Close()
	for order, id := range ids {
		if _, err := tx.Exec(`UPDATE http_variables SET sort_order = ? WHERE id = ?`, order, id); err != nil {
			return fmt.Errorf("repos/variables: reindex %s: %w", id, err)
		}
	}
	return nil
}

// Reorder rewrites one scope's sort_order dense, in the order ids names — ConnectionsService.
// Reorder's own "here is the new order, in full" shape (D14).
func (r *VariablesRepo) Reorder(scope model.VariableScope, ownerID string, ids []string) error {
	if _, err := scopeColumn(scope); err != nil {
		return err
	}
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("repos/variables: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for order, id := range ids {
		if _, err := tx.Exec(`UPDATE http_variables SET sort_order = ? WHERE id = ?`, order, id); err != nil {
			return fmt.Errorf("repos/variables: reorder %s: %w", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/variables: commit: %w", err)
	}
	return nil
}

// History returns one variable's prior values, newest first — never a secret's plaintext or
// ciphertext (the same list-projection discipline as List above). Reveal is the gated path to one.
func (r *VariablesRepo) History(variableID string) ([]model.VariableHistoryEntry, error) {
	rows, err := r.db.Query(
		`SELECT id, variable_id, value, is_secret, recorded_at FROM http_variable_history
		  WHERE variable_id = ? ORDER BY recorded_at DESC, rowid DESC`,
		variableID,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/variables: query history: %w", err)
	}
	defer rows.Close()

	out := []model.VariableHistoryEntry{}
	for rows.Next() {
		var (
			e        model.VariableHistoryEntry
			isSecret int
		)
		if err := rows.Scan(&e.ID, &e.VariableID, &e.Value, &isSecret, &e.RecordedAt); err != nil {
			return nil, fmt.Errorf("repos/variables: scan history entry: %w", err)
		}
		e.IsSecret = isSecret != 0
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/variables: history rows: %w", err)
	}
	return out, nil
}

// ---- the gated reveal's own accessors (D8) — called only after httpvars.Service has already
// authorized the reveal; neither method gates anything itself. ----

// RevealValue decrypts one variable's stored secret. Returns an error for a variable that either
// does not exist or is not a secret — httpvars.Service.Reveal turns that into its own
// never-throws RevealResult, exactly as connections.Service.Reveal already does for a decrypt
// failure.
func (r *VariablesRepo) RevealValue(variableID string) (string, error) {
	var (
		isSecretInt int
		secretValue sql.NullString
	)
	err := r.db.QueryRow(`SELECT is_secret, secret_value FROM http_variables WHERE id = ?`, variableID).Scan(&isSecretInt, &secretValue)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("repos/variables: no variable %s", variableID)
	}
	if err != nil {
		return "", fmt.Errorf("repos/variables: read variable %s: %w", variableID, err)
	}
	if isSecretInt == 0 || !secretValue.Valid {
		return "", fmt.Errorf("repos/variables: variable %s is not a secret", variableID)
	}
	plain, err := r.cipher.Decrypt(secretValue.String)
	if err != nil {
		return "", fmt.Errorf("repos/variables: decrypt %s: %w", variableID, err)
	}
	return plain, nil
}

// RevealHistoryValue is RevealValue's sibling over http_variable_history — a secret's old value is
// exactly as sensitive as its current one (D13).
func (r *VariablesRepo) RevealHistoryValue(historyID string) (string, error) {
	var (
		isSecretInt int
		secretValue sql.NullString
	)
	err := r.db.QueryRow(`SELECT is_secret, secret_value FROM http_variable_history WHERE id = ?`, historyID).Scan(&isSecretInt, &secretValue)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("repos/variables: no history entry %s", historyID)
	}
	if err != nil {
		return "", fmt.Errorf("repos/variables: read history entry %s: %w", historyID, err)
	}
	if isSecretInt == 0 || !secretValue.Valid {
		return "", fmt.Errorf("repos/variables: history entry %s is not a secret", historyID)
	}
	plain, err := r.cipher.Decrypt(secretValue.String)
	if err != nil {
		return "", fmt.Errorf("repos/variables: decrypt history entry %s: %w", historyID, err)
	}
	return plain, nil
}

// SecretsFor decrypts every secret variable reachable from a send — D2's precedence, environment
// over collection, applied here as "insert the collection's secrets, then let the environment's
// overwrite same-named ones", so the returned map already reflects who wins. Either id may be ""
// (a scratch tab has no collection; no environment may be selected). A single entry's decrypt
// failure is logged (naming the variable, never the value, D5) and simply absent from the result —
// D10: the reference then resolves to nothing and the reference stays literal, rather than failing
// the whole send over one bad row.
func (r *VariablesRepo) SecretsFor(collectionID, environmentID string) (map[string]string, error) {
	out := map[string]string{}
	if collectionID != "" {
		if err := r.mergeSecrets(out, "collection_id", collectionID); err != nil {
			return nil, err
		}
	}
	if environmentID != "" {
		if err := r.mergeSecrets(out, "environment_id", environmentID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (r *VariablesRepo) mergeSecrets(out map[string]string, column, ownerID string) error {
	rows, err := r.db.Query(`SELECT name, secret_value FROM http_variables WHERE `+column+` = ? AND is_secret = 1`, ownerID)
	if err != nil {
		return fmt.Errorf("repos/variables: query secrets: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var secretValue sql.NullString
		if err := rows.Scan(&name, &secretValue); err != nil {
			return fmt.Errorf("repos/variables: scan secret: %w", err)
		}
		if !secretValue.Valid {
			continue
		}
		plain, err := r.cipher.Decrypt(secretValue.String)
		if err != nil {
			slog.Warn("a secret variable could not be decrypted while resolving a request", "scope", "storage/variables", "name", name, "err", err)
			continue
		}
		out[name] = plain
	}
	return rows.Err()
}

// ---- import promotion (P4 D9's hand-off, closed by D15/F5) ----

// promotedVariableRow is one collection-level `variable[]` entry as it appears in a pre-P5
// collection's origin_json. Decoded independently of internal/postman's own decoders (which are
// unexported, and this package must not reach past that) — this is the one place a
// collection-level variable array needs decoding with no postman.Tree machinery around it.
type promotedVariableRow struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
	Type  string          `json:"type"`
}

// scalarString mirrors postman's own decodeScalarString for the one field (variable.value) this
// package needs to decode the same lenient way: a JSON string, number or boolean, rendered as its
// literal text — F2's own finding that Postman's variable.value is untyped.
func scalarString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	switch raw[0] {
	case '"':
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
	case 't', 'f':
		var b bool
		if json.Unmarshal(raw, &b) == nil {
			return strconv.FormatBool(b)
		}
	case '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9':
		var n json.Number
		if json.Unmarshal(raw, &n) == nil {
			return n.String()
		}
	}
	return ""
}

// promoteIfNeeded is D15/F5's one-shot: a collection imported before this phase still carries its
// top-level `variable[]` inside origin_json (variables_promoted = 0). This moves it into rows,
// sheds the member from origin_json so the exporter never re-emits it from there, and stamps the
// flag — all inside one transaction, idempotent (a second call is a no-op because the flag is
// already 1).
func (r *VariablesRepo) promoteIfNeeded(collectionID string) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("repos/variables: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var (
		originJSON string
		promoted   bool
	)
	err = tx.QueryRow(`SELECT origin_json, variables_promoted FROM http_collections WHERE id = ?`, collectionID).Scan(&originJSON, &promoted)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("repos/variables: no collection %s", collectionID)
	}
	if err != nil {
		return fmt.Errorf("repos/variables: read collection %s: %w", collectionID, err)
	}
	if promoted {
		return nil
	}

	origin := map[string]json.RawMessage{}
	if originJSON != "" {
		if err := json.Unmarshal([]byte(originJSON), &origin); err != nil {
			slog.Warn("collection origin is not a JSON object; nothing to promote", "scope", "storage/variables", "collectionId", collectionID)
			origin = map[string]json.RawMessage{}
		}
	}

	var entries []promotedVariableRow
	if raw, ok := origin["variable"]; ok {
		if err := json.Unmarshal(raw, &entries); err != nil {
			slog.Warn("collection variable[] is not an array; nothing to promote", "scope", "storage/variables", "collectionId", collectionID)
			entries = nil
		}
	}
	delete(origin, "variable")

	if len(entries) > 0 {
		var order int
		if err := tx.QueryRow(`SELECT COALESCE(MAX(sort_order) + 1, 0) FROM http_variables WHERE collection_id = ?`, collectionID).Scan(&order); err != nil {
			return fmt.Errorf("repos/variables: next variable order: %w", err)
		}
		now := model.NowISO()
		for _, entry := range entries {
			if entry.Key == "" {
				continue
			}
			isSecret := entry.Type == "secret"
			plain := scalarString(entry.Value)
			storedValue, storedSecret, err := r.encryptFor(plain, isSecret)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(
				`INSERT INTO http_variables (id, collection_id, environment_id, name, value, is_secret, secret_value, sort_order, created_at, updated_at)
				 VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
				uuid.NewString(), collectionID, entry.Key, storedValue, boolToInt(isSecret), storedSecret, order, now, now,
			); err != nil {
				return fmt.Errorf("repos/variables: insert promoted variable: %w", err)
			}
			order++
		}
	}

	encodedOrigin, err := encodeJSON(origin)
	if err != nil {
		return fmt.Errorf("repos/variables: encode origin: %w", err)
	}
	if _, err := tx.Exec(
		`UPDATE http_collections SET origin_json = ?, variables_promoted = 1, updated_at = ? WHERE id = ?`,
		string(encodedOrigin), model.NowISO(), collectionID,
	); err != nil {
		return fmt.Errorf("repos/variables: stamp promoted: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/variables: commit: %w", err)
	}
	return nil
}

// PromoteImported is promoteIfNeeded's exported entry point (used directly by
// repos/collections.go's ImportTree/LoadTree wiring in the postman commit, and available for a
// caller that wants to force promotion outside of List's own lazy trigger).
func (r *VariablesRepo) PromoteImported(collectionID string) error {
	return r.promoteIfNeeded(collectionID)
}
