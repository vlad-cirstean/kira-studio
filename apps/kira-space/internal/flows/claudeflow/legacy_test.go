package claudeflow_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/claudecfg"
)

const legacyConfig = `{
  "numStartups": 7,
  "mcpServers": {
    "kira-memory": {"type":"stdio","command":"/Applications/Kira Space.app/Contents/MacOS/Kira Space","args":["memory-mcp"]},
    "kira-db": {"type":"http","url":"http://127.0.0.1:8766/mcp","headersHelper":"'/Users/a b/.kira-studio/mcp-header-helper.sh'"},
    "kira-repo-map": {"type":"http","url":"http://127.0.0.1:51234/mcp","headers":{"Authorization":"Bearer secret-token"}},
    "mine": {"type":"stdio","command":"/usr/bin/mine","args":["serve"]},
    "kira-memory-dev": {"type":"stdio","command":"/Applications/Kira Space.app/Contents/MacOS/Kira Space","args":["memory-mcp"]}
  },
  "projects": {"/x": {"allowedTools": []}}
}
`

func readDoc(t *testing.T, path string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func TestLegacyCleanup(t *testing.T) {
	t.Run("home_config", func(t *testing.T) {
		app := flowharness.New(t)
		fakeCLI(t, app)
		cfg := filepath.Join(app.Home, ".claude.json")
		writeFile(t, cfg, legacyConfig)

		status := app.W.Memory.ClaudeLegacy()
		var names []string
		for _, e := range status.Entries {
			names = append(names, e.Name)
			if e.Summary == "" || e.Summary == "secret-token" {
				t.Fatalf("entry %+v has an empty or secret summary", e)
			}
		}
		if status.File != cfg || !reflect.DeepEqual(names, []string{"kira-memory", "kira-db", "kira-repo-map"}) {
			t.Fatalf("ClaudeLegacy = %+v, want the three Kira entries in %s", status, cfg)
		}

		res := app.W.Memory.RemoveClaudeLegacy(ctx)
		if res.Outcome != claudecfg.OutcomeRemoved || len(res.Removed) != 3 || len(res.Remaining) != 0 {
			t.Fatalf("RemoveClaudeLegacy = %+v, want all three removed", res)
		}
		backup, err := os.ReadFile(res.BackupPath)
		if err != nil || string(backup) != legacyConfig {
			t.Fatalf("backup %s = %q, %v, want the pre-cleanup file byte for byte", res.BackupPath, backup, err)
		}
		if st, _ := os.Stat(res.BackupPath); st.Mode().Perm() != 0o600 {
			t.Fatalf("backup mode = %v, want 0600", st.Mode().Perm())
		}
		if filepath.Dir(res.BackupPath) != filepath.Join(app.SpaceHome, "claude-config-backups") {
			t.Fatalf("backup path = %s, want under the Kira Space home", res.BackupPath)
		}

		want := readDoc(t, cfg)
		var orig map[string]any
		if err := json.Unmarshal([]byte(legacyConfig), &orig); err != nil {
			t.Fatal(err)
		}
		servers := orig["mcpServers"].(map[string]any)
		for _, gone := range []string{"kira-memory", "kira-db", "kira-repo-map"} {
			delete(servers, gone)
		}
		if !reflect.DeepEqual(want, orig) {
			t.Fatalf("config after cleanup = %v, want the original minus the Kira entries: %v", want, orig)
		}
		if l := app.W.Memory.ClaudeLegacy(); len(l.Entries) != 0 {
			t.Fatalf("ClaudeLegacy after cleanup = %+v, want none", l)
		}
		if again := app.W.Memory.RemoveClaudeLegacy(ctx); again.Outcome != claudecfg.OutcomeNothing {
			t.Fatalf("second RemoveClaudeLegacy = %+v, want nothing", again)
		}
	})

	t.Run("config_dir", func(t *testing.T) {
		app := flowharness.New(t)
		fakeCLI(t, app)
		dir := t.TempDir()
		t.Setenv("CLAUDE_CONFIG_DIR", dir)
		homeCfg := filepath.Join(app.Home, ".claude.json")
		writeFile(t, homeCfg, legacyConfig)
		homeBefore, _ := os.ReadFile(homeCfg)
		writeFile(t, filepath.Join(dir, ".claude.json"), `{"mcpServers":{
  "kira-db": {"type":"http","url":"http://127.0.0.1:8766/mcp","headers":{"Authorization":"Bearer old"}},
  "kira-memory": {"type":"stdio","command":"/Applications/Kira Space.app/Contents/MacOS/Kira Space","args":["memory-mcp"],"env":{"A":"b"}}
}}`)

		status := app.W.Memory.ClaudeLegacy()
		if len(status.Entries) != 1 || status.Entries[0].Name != "kira-db" {
			t.Fatalf("ClaudeLegacy = %+v, want only kira-db from the config dir", status)
		}
		if res := app.W.Memory.RemoveClaudeLegacy(ctx); res.Outcome != claudecfg.OutcomeRemoved || len(res.Removed) != 1 {
			t.Fatalf("RemoveClaudeLegacy = %+v, want kira-db removed", res)
		}
		servers := readDoc(t, filepath.Join(dir, ".claude.json"))["mcpServers"].(map[string]any)
		if _, ok := servers["kira-memory"]; !ok || len(servers) != 1 {
			t.Fatalf("config dir servers = %v, want only the kira-memory entry with an env key", servers)
		}
		if after, _ := os.ReadFile(homeCfg); !bytes.Equal(after, homeBefore) {
			t.Fatal("cleanup touched ~/.claude.json while CLAUDE_CONFIG_DIR was set")
		}
	})

	t.Run("no_cli", func(t *testing.T) {
		app := flowharness.New(t, flowharness.WithoutGh())
		if err := os.Remove(filepath.Join(app.BinDir, "claude")); err != nil {
			t.Fatal(err)
		}
		cfg := filepath.Join(app.Home, ".claude.json")
		writeFile(t, cfg, legacyConfig)

		res := app.W.Memory.RemoveClaudeLegacy(ctx)
		if res.Outcome != claudecfg.OutcomeNotFound || len(res.Commands) != 3 || res.BackupPath != "" {
			t.Fatalf("RemoveClaudeLegacy = %+v, want notFound with three commands and no backup", res)
		}
		if after, _ := os.ReadFile(cfg); string(after) != legacyConfig {
			t.Fatal("cleanup edited the config without the CLI")
		}
		if _, err := os.Stat(filepath.Join(app.SpaceHome, "claude-config-backups")); !os.IsNotExist(err) {
			t.Fatalf("backup dir exists without a cleanup: %v", err)
		}
	})
}
