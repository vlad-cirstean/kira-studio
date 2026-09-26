// Package migrations embeds the schema migration(s). The app has never shipped, so there is no
// installed base with a partially-applied schema to preserve — what were five incremental steps
// (0001_init through 0005_p28_tree_filters) are collapsed into the single 0001_init.sql that
// produces the exact same final schema in one shot (verified table-by-table via
// PRAGMA table_info/foreign_key_list/index_list against the old five-file sequence before they
// were deleted).
package migrations

import (
	"embed"

	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

//go:embed *.sql
var files embed.FS

// names lists the embedded files in the exact order they must apply, rather than trusting
// directory listing order.
var names = []sqlitex.MigrationSource{
	{Version: 1, Name: "init", File: "0001_init.sql"},
	{Version: 2, Name: "p8_windows", File: "0002_p8_windows.sql"},
	{Version: 3, Name: "p18_connection_ddl", File: "0003_p18_connection_ddl.sql"},
	{Version: 4, Name: "p18_auto_explain", File: "0004_p18_auto_explain.sql"},
	{Version: 5, Name: "p28_throttle", File: "0005_p28_throttle.sql"},
	{Version: 6, Name: "p4_collections", File: "0006_p4_collections.sql"},
	{Version: 7, Name: "p5_variables", File: "0007_p5_variables.sql"},
	{Version: 8, Name: "p8_response_history", File: "0008_p8_response_history.sql"},
	{Version: 9, Name: "p11_grpc", File: "0009_p11_grpc.sql"},
	{Version: 10, Name: "p12_api_rename", File: "0010_p12_api_rename.sql"},
	{Version: 11, Name: "p17_variable_description", File: "0011_p17_variable_description.sql"},
	{Version: 12, Name: "p18_environment_color", File: "0012_p18_environment_color.sql"},
	{Version: 13, Name: "p21r3_history_bytes_index", File: "0013_p21r3_history_bytes_index.sql"},
	{Version: 14, Name: "p22_window_mode", File: "0014_p22_window_mode.sql"},
	{Version: 15, Name: "p23_op_log_bytes", File: "0015_p23_op_log_bytes.sql"},
	{Version: 16, Name: "g1_git_clients", File: "0016_g1_git_clients.sql"},
	{Version: 17, Name: "g18_git_repo_settings", File: "0017_g18_git_repo_settings.sql"},
	{Version: 18, Name: "c5_code_repos", File: "0018_c5_code_repos.sql"},
	{Version: 19, Name: "p67d_repo_map_access", File: "0019_p67d_repo_map_access.sql"},
	{Version: 20, Name: "m1_connection_mcp", File: "0020_m1_connection_mcp.sql"},
	{Version: 21, Name: "m2_connection_permissions", File: "0021_m2_connection_permissions.sql"},
	{Version: 22, Name: "m3_connection_mcp_explain", File: "0022_m3_connection_mcp_explain.sql"},
	{Version: 23, Name: "m5_column_mask_rules", File: "0023_m5_column_mask_rules.sql"},
	{Version: 24, Name: "p85_custom_scripts", File: "0024_p85_custom_scripts.sql"},
	{Version: 25, Name: "p97_drop_repo_map", File: "0025_p97_drop_repo_map.sql"},
	{Version: 26, Name: "p100_drop_git_tables", File: "0026_p100_drop_git_tables.sql"},
	{Version: 27, Name: "p108part11_op_log_path", File: "0027_p108part11_op_log_path.sql"},
	{Version: 28, Name: "p120_drop_git_settings", File: "0028_p120_drop_git_settings.sql"},
}

// All returns every migration in ascending version order.
func All() ([]sqlitex.Migration, error) {
	return sqlitex.LoadMigrations(files, names)
}
