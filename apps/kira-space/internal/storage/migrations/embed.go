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
}

// All returns every migration in ascending version order.
func All() ([]sqlitex.Migration, error) {
	return sqlitex.LoadMigrations(files, names)
}
