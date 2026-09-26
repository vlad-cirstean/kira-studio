package repos

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

const maskRulesSelectColumns = `
	id, connection_id, table_name, column_name, mask_kind, keep_hint, correlate, created_at, updated_at
`

// MaskRulesRepo reads and writes connection_mask_rules (M5 §3.1/§3.2) — a plain shape: a
// selectColumns const, a scan*Row(rowScanner) helper, each query ordered deterministically.
type MaskRulesRepo struct {
	DB *sql.DB
}

func scanMaskRuleRow(row rowScanner) (model.MaskRule, error) {
	var (
		r                   model.MaskRule
		kind                string
		keepHint, correlate int
	)
	if err := row.Scan(
		&r.ID, &r.ConnectionID, &r.TableName, &r.ColumnName, &kind, &keepHint, &correlate,
		&r.CreatedAt, &r.UpdatedAt,
	); err != nil {
		return model.MaskRule{}, err
	}
	r.Kind = model.MaskKind(kind)
	r.KeepHint = keepHint != 0
	r.Correlate = correlate != 0
	return r, nil
}

// queryer is satisfied by both *sql.DB and *sql.Tx — listForConnection (below) runs the identical
// query over either, so CopyForConnection's own transaction (F8) can share it with ListForConnection
// rather than keeping a second, drifting copy of the same query/scan loop.
type queryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

// ListForConnection orders by lower(table_name), lower(column_name) — deterministic and matching
// the unique index's own ordering, so two rules that would collide under the case-insensitive
// constraint never come back in arbitrary order relative to each other.
func (r *MaskRulesRepo) ListForConnection(connectionID string) ([]model.MaskRule, error) {
	return listForConnection(r.DB, connectionID)
}

func listForConnection(q queryer, connectionID string) ([]model.MaskRule, error) {
	rows, err := q.Query(
		`SELECT `+maskRulesSelectColumns+` FROM connection_mask_rules WHERE connection_id = ? ORDER BY lower(table_name), lower(column_name)`,
		connectionID,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/maskrules: list %s: %w", connectionID, err)
	}
	defer rows.Close()

	out := []model.MaskRule{}
	for rows.Next() {
		rec, err := scanMaskRuleRow(rows)
		if err != nil {
			return nil, fmt.Errorf("repos/maskrules: scan: %w", err)
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/maskrules: rows: %w", err)
	}
	return out, nil
}

// Get reads one rule by id, (nil, nil) when not found.
func (r *MaskRulesRepo) Get(id string) (*model.MaskRule, error) {
	rec, err := sqlitex.QueryOne(r.DB, func(row *sql.Row) (*model.MaskRule, error) {
		m, err := scanMaskRuleRow(row)
		if err != nil {
			return nil, err
		}
		return &m, nil
	}, `SELECT `+maskRulesSelectColumns+` FROM connection_mask_rules WHERE id = ?`, id)
	if err != nil {
		return nil, fmt.Errorf("repos/maskrules: get %s: %w", id, err)
	}
	return rec, nil
}

// Upsert writes one rule on (connection_id, lower(table_name), lower(column_name)) — the unique
// index's own key — inserting a fresh id on first write and reusing the existing row's id and
// created_at on a later one for the same column, so a rule keeps a stable identity across edits.
// id is a fresh uuid the caller (internal/maskrules.Service) mints for a genuinely new row; ok to
// pass "" only when connectionID+fields are known not to collide with an existing row (the service
// itself never does this — it always resolves the existing id first via ListForConnection).
func (r *MaskRulesRepo) Upsert(id, connectionID string, f model.MaskRuleFields, now string) (model.MaskRule, error) {
	existing, err := r.findExisting(connectionID, f.TableName, f.ColumnName)
	if err != nil {
		return model.MaskRule{}, err
	}
	createdAt := now
	rowID := id
	if existing != nil {
		rowID = existing.ID
		createdAt = existing.CreatedAt
	}
	if _, err := r.DB.Exec(`
		INSERT INTO connection_mask_rules
			(id, connection_id, table_name, column_name, mask_kind, keep_hint, correlate, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(connection_id, lower(table_name), lower(column_name)) DO UPDATE SET
			table_name = excluded.table_name,
			column_name = excluded.column_name,
			mask_kind = excluded.mask_kind,
			keep_hint = excluded.keep_hint,
			correlate = excluded.correlate,
			updated_at = excluded.updated_at
	`,
		rowID, connectionID, f.TableName, f.ColumnName, string(f.Kind), boolToInt(f.KeepHint), boolToInt(f.Correlate),
		createdAt, now,
	); err != nil {
		return model.MaskRule{}, fmt.Errorf("repos/maskrules: upsert %s/%s.%s: %w", connectionID, f.TableName, f.ColumnName, err)
	}

	rec, err := r.findExisting(connectionID, f.TableName, f.ColumnName)
	if err != nil {
		return model.MaskRule{}, err
	}
	if rec == nil {
		return model.MaskRule{}, fmt.Errorf("repos/maskrules: row %s/%s.%s not readable after upsert", connectionID, f.TableName, f.ColumnName)
	}
	return *rec, nil
}

// findExisting reads the row the unique index would collide with, case-insensitively — Upsert's
// own "does a row for this column already exist" check.
func (r *MaskRulesRepo) findExisting(connectionID, tableName, columnName string) (*model.MaskRule, error) {
	rec, err := sqlitex.QueryOne(r.DB, func(row *sql.Row) (*model.MaskRule, error) {
		m, err := scanMaskRuleRow(row)
		if err != nil {
			return nil, err
		}
		return &m, nil
	},
		`SELECT `+maskRulesSelectColumns+` FROM connection_mask_rules
		 WHERE connection_id = ? AND lower(table_name) = lower(?) AND lower(column_name) = lower(?)`,
		connectionID, tableName, columnName,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/maskrules: find %s/%s.%s: %w", connectionID, tableName, columnName, err)
	}
	return rec, nil
}

// CopyForConnection copies every mask rule on fromConnectionID onto toConnectionID, each under a
// fresh id mintID mints — connections.Service.Duplicate's own use (finding #6, M6): a duplicated
// connection that carried over the source's MCP exposure without its mask rules would immediately
// expose PII the original was protecting. mintID is the caller's own id generator
// (uuid.NewString, the same way Upsert's own id argument is minted) rather than a uuid dependency
// in this package, called once per row inside the same transaction the list runs in.
//
// F8 (P108 Part 3): the list and the inserts now share one transaction, rather than the caller
// listing once (to count rows and mint that many ids) and this method listing *again* to actually
// copy them — a concurrent rule add/remove on fromConnectionID between those two separate list
// calls used to produce an "N ids for M rules" mismatch here, by which point Duplicate's own new
// connection row was already committed; since the mismatch error is returned before
// emitListChanged runs, the UI never learns about the (now partially set up) new connection at
// all. One transaction removes the mismatch entirely — the list and every insert it drives see
// the same snapshot, so there is nothing left to race.
//
// mask_correlation_key lives on `connections`, not this table, and is never touched here —
// InsertDuplicateWithSecret's own doc comment gives the reasoning for why a duplicate must mint
// its own key rather than inherit the source's.
func (r *MaskRulesRepo) CopyForConnection(fromConnectionID, toConnectionID string, mintID func() string, now string) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos/maskrules: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	rows, err := listForConnection(tx, fromConnectionID)
	if err != nil {
		return err
	}

	for _, row := range rows {
		if _, err := tx.Exec(`
			INSERT INTO connection_mask_rules
				(id, connection_id, table_name, column_name, mask_kind, keep_hint, correlate, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			mintID(), toConnectionID, row.TableName, row.ColumnName, string(row.Kind),
			boolToInt(row.KeepHint), boolToInt(row.Correlate), now, now,
		); err != nil {
			return fmt.Errorf("repos/maskrules: copy %s/%s.%s to %s: %w", fromConnectionID, row.TableName, row.ColumnName, toConnectionID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/maskrules: commit: %w", err)
	}
	return nil
}

// Remove deletes one rule by id. Not an error when id matches no row (Service.Remove's own
// idempotent "not PII any more" semantics).
func (r *MaskRulesRepo) Remove(id string) error {
	if _, err := r.DB.Exec(`DELETE FROM connection_mask_rules WHERE id = ?`, id); err != nil {
		return fmt.Errorf("repos/maskrules: remove %s: %w", id, err)
	}
	return nil
}

// CountByConnection returns every connection id that has at least one rule, mapped to its rule
// count — the Settings glance's own backend (§7.5), and the "does this connection have any rules
// at all" check §4.4's document/stream refusal and §6.2's toolbar-button visibility both need.
func (r *MaskRulesRepo) CountByConnection() (map[string]int, error) {
	rows, err := r.DB.Query(`SELECT connection_id, COUNT(*) FROM connection_mask_rules GROUP BY connection_id`)
	if err != nil {
		return nil, fmt.Errorf("repos/maskrules: count by connection: %w", err)
	}
	defer rows.Close()

	out := map[string]int{}
	for rows.Next() {
		var connID string
		var count int
		if err := rows.Scan(&connID, &count); err != nil {
			return nil, fmt.Errorf("repos/maskrules: scan count: %w", err)
		}
		out[connID] = count
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/maskrules: rows: %w", err)
	}
	return out, nil
}
