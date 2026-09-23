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
	appsettings.LeafValid(stored, "data.defaultPageSize", &result.Data.DefaultPageSize, model.ValidPageSize)
	appsettings.LeafValid(stored, "cache.l2BudgetMb", &result.Cache.L2BudgetMb, appsettings.InRange(8, 1024))
	appsettings.LeafValid(stored, "advanced.opLogRetentionDays", &result.Advanced.OpLogRetentionDays, appsettings.InRange(1, 365))
	appsettings.LeafValid(stored, "advanced.expensiveQueryRows", &result.Advanced.ExpensiveQueryRows, appsettings.InRange(1_000, 1_000_000_000))
	appsettings.LeafValid(stored, "advanced.gitLogLevel", &result.Advanced.GitLogLevel, appsettings.ValidLogLevel)
	appsettings.LeafValid(stored, "api.httpVersion", &result.Api.HTTPVersion, model.ValidHTTPVersion)
	appsettings.LeafValid(stored, "api.requestTimeoutMs", &result.Api.RequestTimeoutMs, appsettings.InRange(0, 3_600_000))
	appsettings.LeafValid(stored, "api.maxResponseMb", &result.Api.MaxResponseMb, appsettings.InRange(0, 2048))
	appsettings.Leaf(stored, "api.sslVerify", &result.Api.SSLVerify)
	appsettings.Leaf(stored, "api.followRedirects", &result.Api.FollowRedirects)
	appsettings.LeafValid(stored, "api.maxRedirects", &result.Api.MaxRedirects, appsettings.InRange(0, 100))
	appsettings.Leaf(stored, "api.disableCookieJar", &result.Api.DisableCookieJar)
	appsettings.Leaf(stored, "dbMcp.serverEnabled", &result.DbMcp.ServerEnabled)
	appsettings.Leaf(stored, "claudeCode.hooksEnabled", &result.ClaudeCode.HooksEnabled)
	appsettings.Leaf(stored, "claudeCode.hooksPromptDismissed", &result.ClaudeCode.HooksPromptDismissed)
	appsettings.Leaf(stored, "claudeCode.keepAwakeWithAgents", &result.ClaudeCode.KeepAwakeWithAgents)
	return result, nil
}

func upsertDataSection(tx *sql.Tx, d *model.DataPatch) error {
	if d == nil || d.DefaultPageSize == nil {
		return nil
	}
	return appsettings.UpsertLeaf(tx, "data.defaultPageSize", *d.DefaultPageSize)
}

func upsertCacheSection(tx *sql.Tx, c *model.CachePatch) error {
	if c == nil || c.L2BudgetMb == nil {
		return nil
	}
	return appsettings.UpsertLeaf(tx, "cache.l2BudgetMb", *c.L2BudgetMb)
}

func upsertAdvancedSection(tx *sql.Tx, a *model.AdvancedPatch) error {
	if a == nil {
		return nil
	}
	if a.OpLogRetentionDays != nil {
		if err := appsettings.UpsertLeaf(tx, "advanced.opLogRetentionDays", *a.OpLogRetentionDays); err != nil {
			return err
		}
	}
	if a.ExpensiveQueryRows != nil {
		if err := appsettings.UpsertLeaf(tx, "advanced.expensiveQueryRows", *a.ExpensiveQueryRows); err != nil {
			return err
		}
	}
	if a.GitLogLevel != nil {
		if err := appsettings.UpsertLeaf(tx, "advanced.gitLogLevel", *a.GitLogLevel); err != nil {
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
		if err := appsettings.UpsertLeaf(tx, "api.httpVersion", *a.HTTPVersion); err != nil {
			return err
		}
	}
	if a.RequestTimeoutMs != nil {
		if err := appsettings.UpsertLeaf(tx, "api.requestTimeoutMs", *a.RequestTimeoutMs); err != nil {
			return err
		}
	}
	if a.MaxResponseMb != nil {
		if err := appsettings.UpsertLeaf(tx, "api.maxResponseMb", *a.MaxResponseMb); err != nil {
			return err
		}
	}
	if a.SSLVerify != nil {
		if err := appsettings.UpsertLeaf(tx, "api.sslVerify", *a.SSLVerify); err != nil {
			return err
		}
	}
	if a.FollowRedirects != nil {
		if err := appsettings.UpsertLeaf(tx, "api.followRedirects", *a.FollowRedirects); err != nil {
			return err
		}
	}
	if a.MaxRedirects != nil {
		if err := appsettings.UpsertLeaf(tx, "api.maxRedirects", *a.MaxRedirects); err != nil {
			return err
		}
	}
	if a.DisableCookieJar != nil {
		if err := appsettings.UpsertLeaf(tx, "api.disableCookieJar", *a.DisableCookieJar); err != nil {
			return err
		}
	}
	return nil
}

func upsertDbMcpSection(tx *sql.Tx, dm *model.DbMcpPatch) error {
	if dm == nil || dm.ServerEnabled == nil {
		return nil
	}
	return appsettings.UpsertLeaf(tx, "dbMcp.serverEnabled", *dm.ServerEnabled)
}

func upsertClaudeCodeSection(tx *sql.Tx, cc *model.ClaudeCodePatch) error {
	if cc == nil {
		return nil
	}
	if cc.HooksEnabled != nil {
		if err := appsettings.UpsertLeaf(tx, "claudeCode.hooksEnabled", *cc.HooksEnabled); err != nil {
			return err
		}
	}
	if cc.HooksPromptDismissed != nil {
		if err := appsettings.UpsertLeaf(tx, "claudeCode.hooksPromptDismissed", *cc.HooksPromptDismissed); err != nil {
			return err
		}
	}
	if cc.KeepAwakeWithAgents != nil {
		if err := appsettings.UpsertLeaf(tx, "claudeCode.keepAwakeWithAgents", *cc.KeepAwakeWithAgents); err != nil {
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
