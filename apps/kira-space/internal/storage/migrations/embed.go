// Package migrations embeds Kira Space's own schema migrations — the app shipped no installed base
// before P100 Part 2, so 0001/0002 stayed one collapsed init pair the same shape Kira Studio's own
// migrations package used (see that package's own doc comment); every migration since (P128's own
// 0003) applies in the ordinary way against whatever schema is already on disk.
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
	{Version: 2, Name: "p100_tabs_layout", File: "0002_p100_tabs_layout.sql"},
	{Version: 3, Name: "p128_window_mode", File: "0003_p128_window_mode.sql"},
	{Version: 4, Name: "p129_ade_sessions", File: "0004_p129_ade_sessions.sql"},
	{Version: 5, Name: "p129_ade_queue", File: "0005_p129_ade_queue.sql"},
	{Version: 6, Name: "p135_ade_dependencies", File: "0006_p135_ade_dependencies.sql"},
	{Version: 7, Name: "p136_ade_work_type", File: "0007_p136_ade_work_type.sql"},
	{Version: 8, Name: "p144_ade_tasks", File: "0008_p144_ade_tasks.sql"},
	{Version: 9, Name: "p145_ade_marks", File: "0009_p145_ade_marks.sql"},
	{Version: 10, Name: "p146_ade_runs", File: "0010_p146_ade_runs.sql"},
	{Version: 11, Name: "p148_drop_ade_v1", File: "0011_p148_drop_ade_v1.sql"},
	{Version: 12, Name: "p150_review", File: "0012_p150_review.sql"},
	{Version: 13, Name: "p155_drop_all_agents_filter", File: "0013_p155_drop_all_agents_filter.sql"},
	{Version: 14, Name: "p156_run_launch_spec", File: "0014_p156_run_launch_spec.sql"},
	{Version: 15, Name: "p158_drop_run_todo", File: "0015_p158_drop_run_todo.sql"},
	{Version: 16, Name: "p177_ade_logs_purge", File: "0016_p177_ade_logs_purge.sql"},
	{Version: 17, Name: "p196_ade_task_workflow_snapshot", File: "0017_p196_ade_task_workflow_snapshot.sql"},
	{Version: 18, Name: "p199_ade_branch_origin", File: "0018_p199_ade_branch_origin.sql"},
	{Version: 19, Name: "p202_ade_setup_note", File: "0019_p202_ade_setup_note.sql"},
	{Version: 20, Name: "p204_custom_scripts", File: "0020_p204_custom_scripts.sql"},
	{Version: 21, Name: "p212_mobile_devices", File: "0021_p212_mobile_devices.sql"},
	{Version: 22, Name: "p212_mobile_permissions", File: "0022_p212_mobile_permissions.sql"},
	{Version: 23, Name: "p219_quick_command_collections", File: "0023_p219_quick_command_collections.sql"},
	{Version: 24, Name: "p222_code_repo_color", File: "0024_p222_code_repo_color.sql"},
	{Version: 25, Name: "p223_mobile_lan", File: "0025_p223_mobile_lan.sql"},
	{Version: 26, Name: "p242_automations", File: "0026_p242_automations.sql"},
	{Version: 27, Name: "p241_rebase", File: "0027_p241_rebase.sql"},
	{Version: 28, Name: "p242_smart_scripts", File: "0028_p242_smart_scripts.sql"},
	{Version: 29, Name: "p242_scripts_in_ade", File: "0029_p242_scripts_in_ade.sql"},
	{Version: 30, Name: "p242_recurring_scripts", File: "0030_p242_recurring_scripts.sql"},
	{Version: 31, Name: "p243_drop_git_clients", File: "0031_p243_drop_git_clients.sql"},
	{Version: 32, Name: "p259_repo_hidden", File: "0032_p259_repo_hidden.sql"},
}

// All returns every migration in ascending version order.
func All() ([]sqlitex.Migration, error) {
	return sqlitex.LoadMigrations(files, names)
}
