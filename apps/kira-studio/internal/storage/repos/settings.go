// Package repos is the Go analogue of src/main/storage/repos/*.ts.
package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appsettings"
)

// SettingsRepo reads and writes the `settings` table, one JSON-valued row per leaf
// (`${section}.${key}`), never a blob per section — settings.ts's own per-leaf fallback is what
// lets a row written before a key existed still parse (P52 §4.3).
const settingsSelectAllSQL = `SELECT key, value FROM settings`

type SettingsRepo struct {
	DB *sql.DB

	// selectAll is prepared once by repos.New (P52 §5.4 — this is one of the app's hot boot-path
	// reads). nil when a SettingsRepo is constructed directly (e.g. in tests), which falls back
	// to an ad-hoc query with identical SQL.
	selectAll *sql.Stmt
}

func (r *SettingsRepo) GetAll() (model.Settings, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if r.selectAll != nil {
		rows, err = r.selectAll.Query()
	} else {
		rows, err = r.DB.Query(settingsSelectAllSQL)
	}
	if err != nil {
		return model.Settings{}, fmt.Errorf("repos/settings: query: %w", err)
	}
	defer rows.Close()

	stored := map[string]json.RawMessage{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return model.Settings{}, fmt.Errorf("repos/settings: scan: %w", err)
		}
		stored[key] = json.RawMessage(value)
	}
	if err := rows.Err(); err != nil {
		return model.Settings{}, fmt.Errorf("repos/settings: rows: %w", err)
	}

	result := model.DefaultSettings()
	result.Appearance = appsettings.ReadAppearance(stored)
	result.Git = appsettings.ReadGit(stored)
	leafValid(stored, "data.defaultPageSize", &result.Data.DefaultPageSize, model.ValidPageSize)
	leafValid(stored, "cache.l2BudgetMb", &result.Cache.L2BudgetMb, appsettings.InRange(8, 1024))
	leafValid(stored, "advanced.opLogRetentionDays", &result.Advanced.OpLogRetentionDays, appsettings.InRange(1, 365))
	leafValid(stored, "advanced.expensiveQueryRows", &result.Advanced.ExpensiveQueryRows, appsettings.InRange(1_000, 1_000_000_000))
	leafValid(stored, "advanced.gitLogLevel", &result.Advanced.GitLogLevel, appsettings.ValidLogLevel)
	leafValid(stored, "api.httpVersion", &result.Api.HTTPVersion, model.ValidHTTPVersion)
	leafValid(stored, "api.requestTimeoutMs", &result.Api.RequestTimeoutMs, appsettings.InRange(0, 3_600_000))
	leafValid(stored, "api.maxResponseMb", &result.Api.MaxResponseMb, appsettings.InRange(0, 2048))
	leaf(stored, "api.sslVerify", &result.Api.SSLVerify)
	leaf(stored, "api.followRedirects", &result.Api.FollowRedirects)
	leafValid(stored, "api.maxRedirects", &result.Api.MaxRedirects, appsettings.InRange(0, 100))
	leaf(stored, "api.disableCookieJar", &result.Api.DisableCookieJar)
	leaf(stored, "dbMcp.serverEnabled", &result.DbMcp.ServerEnabled)
	leaf(stored, "claudeCode.hooksEnabled", &result.ClaudeCode.HooksEnabled)
	leaf(stored, "claudeCode.hooksPromptDismissed", &result.ClaudeCode.HooksPromptDismissed)
	leaf(stored, "claudeCode.keepAwakeWithAgents", &result.ClaudeCode.KeepAwakeWithAgents)
	return result, nil
}

func upsertDataSection(tx *sql.Tx, d *model.DataPatch) error {
	if d == nil || d.DefaultPageSize == nil {
		return nil
	}
	return upsertSettingsLeaf(tx, "data.defaultPageSize", *d.DefaultPageSize)
}

func upsertCacheSection(tx *sql.Tx, c *model.CachePatch) error {
	if c == nil || c.L2BudgetMb == nil {
		return nil
	}
	return upsertSettingsLeaf(tx, "cache.l2BudgetMb", *c.L2BudgetMb)
}

func upsertAdvancedSection(tx *sql.Tx, a *model.AdvancedPatch) error {
	if a == nil {
		return nil
	}
	if a.OpLogRetentionDays != nil {
		if err := upsertSettingsLeaf(tx, "advanced.opLogRetentionDays", *a.OpLogRetentionDays); err != nil {
			return err
		}
	}
	if a.ExpensiveQueryRows != nil {
		if err := upsertSettingsLeaf(tx, "advanced.expensiveQueryRows", *a.ExpensiveQueryRows); err != nil {
			return err
		}
	}
	if a.GitLogLevel != nil {
		if err := upsertSettingsLeaf(tx, "advanced.gitLogLevel", *a.GitLogLevel); err != nil {
			return err
		}
	}
	return nil
}

func upsertApiSection(tx *sql.Tx, a *model.ApiPatch) error {
	if a == nil {
		return nil
	}
	if a.HTTPVersion != nil {
		if err := upsertSettingsLeaf(tx, "api.httpVersion", *a.HTTPVersion); err != nil {
			return err
		}
	}
	if a.RequestTimeoutMs != nil {
		if err := upsertSettingsLeaf(tx, "api.requestTimeoutMs", *a.RequestTimeoutMs); err != nil {
			return err
		}
	}
	if a.MaxResponseMb != nil {
		if err := upsertSettingsLeaf(tx, "api.maxResponseMb", *a.MaxResponseMb); err != nil {
			return err
		}
	}
	if a.SSLVerify != nil {
		if err := upsertSettingsLeaf(tx, "api.sslVerify", *a.SSLVerify); err != nil {
			return err
		}
	}
	if a.FollowRedirects != nil {
		if err := upsertSettingsLeaf(tx, "api.followRedirects", *a.FollowRedirects); err != nil {
			return err
		}
	}
	if a.MaxRedirects != nil {
		if err := upsertSettingsLeaf(tx, "api.maxRedirects", *a.MaxRedirects); err != nil {
			return err
		}
	}
	if a.DisableCookieJar != nil {
		if err := upsertSettingsLeaf(tx, "api.disableCookieJar", *a.DisableCookieJar); err != nil {
			return err
		}
	}
	return nil
}

func upsertDbMcpSection(tx *sql.Tx, dm *model.DbMcpPatch) error {
	if dm == nil || dm.ServerEnabled == nil {
		return nil
	}
	return upsertSettingsLeaf(tx, "dbMcp.serverEnabled", *dm.ServerEnabled)
}

func upsertClaudeCodeSection(tx *sql.Tx, cc *model.ClaudeCodePatch) error {
	if cc == nil {
		return nil
	}
	if cc.HooksEnabled != nil {
		if err := upsertSettingsLeaf(tx, "claudeCode.hooksEnabled", *cc.HooksEnabled); err != nil {
			return err
		}
	}
	if cc.HooksPromptDismissed != nil {
		if err := upsertSettingsLeaf(tx, "claudeCode.hooksPromptDismissed", *cc.HooksPromptDismissed); err != nil {
			return err
		}
	}
	if cc.KeepAwakeWithAgents != nil {
		if err := upsertSettingsLeaf(tx, "claudeCode.keepAwakeWithAgents", *cc.KeepAwakeWithAgents); err != nil {
			return err
		}
	}
	return nil
}

// Set validates the patch, writes only the leaves the caller actually patched in one transaction
// (D15 — a full rewrite would touch eleven unrelated rows), and returns GetAll() afterwards.
func (r *SettingsRepo) Set(patch model.SettingsPatch) (model.Settings, error) {
	if err := patch.Validate(); err != nil {
		return model.Settings{}, fmt.Errorf("repos/settings: %w", err)
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return model.Settings{}, fmt.Errorf("repos/settings: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if err := appsettings.UpsertAppearance(tx, patch.Appearance); err != nil {
		return model.Settings{}, err
	}
	if err := upsertDataSection(tx, patch.Data); err != nil {
		return model.Settings{}, err
	}
	if err := upsertCacheSection(tx, patch.Cache); err != nil {
		return model.Settings{}, err
	}
	if err := upsertAdvancedSection(tx, patch.Advanced); err != nil {
		return model.Settings{}, err
	}
	if err := appsettings.UpsertGit(tx, patch.Git); err != nil {
		return model.Settings{}, err
	}
	if err := upsertApiSection(tx, patch.Api); err != nil {
		return model.Settings{}, err
	}
	if err := upsertDbMcpSection(tx, patch.DbMcp); err != nil {
		return model.Settings{}, err
	}
	if err := upsertClaudeCodeSection(tx, patch.ClaudeCode); err != nil {
		return model.Settings{}, err
	}

	if err := tx.Commit(); err != nil {
		return model.Settings{}, fmt.Errorf("repos/settings: commit: %w", err)
	}
	return r.GetAll()
}

func upsertSettingsLeaf(tx *sql.Tx, key string, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("repos/settings: encode %s: %w", key, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, string(encoded),
	); err != nil {
		return fmt.Errorf("repos/settings: upsert %s: %w", key, err)
	}
	return nil
}

// leaf overwrites *dst with the stored value for key if present, leaving the caller's default in
// place otherwise (settings.ts's sectionFromStore, one key at a time). An unparseable stored
// value is a hand-edited or stale-shape row; it is left at its default rather than propagated,
// the same "fail closed to a known-good value" discipline the TS build's zod parse enforces.
func leaf[T any](stored map[string]json.RawMessage, key string, dst *T) {
	raw, ok := stored[key]
	if !ok {
		return
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return
	}
	*dst = v
}

// leafValid is leaf plus D4's semantic validation: a stored value that parses but fails valid
// falls back to the default too, logged by the caller's own scope elsewhere in this package.
func leafValid[T any](stored map[string]json.RawMessage, key string, dst *T, valid func(T) bool) {
	raw, ok := stored[key]
	if !ok {
		return
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return
	}
	if !valid(v) {
		return
	}
	*dst = v
}
