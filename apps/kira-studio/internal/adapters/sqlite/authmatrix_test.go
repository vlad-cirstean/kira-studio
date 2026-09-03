// authmatrix_test.go is the complete (Tier 2) suite's own table for sqlite — P25 §2.9. SQLite has
// no credentials at all (Username/Password are never read, §1.6), so its permutation axis is path
// handling, not auth. File-permission cases are declined per §1.6/§2.9: this sandbox runs as root,
// which bypasses file modes entirely, so no claim is made either way.
package sqlite_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func TestSqlite_AuthMatrix(t *testing.T) {
	testsupport.RequireMatrix(t)
	f := testsupport.StartSqlite(t)

	missing := filepath.Join(f.Dir, "p25-missing.sqlite")
	garbage := filepath.Join(f.Dir, "p25-garbage.sqlite")
	if err := os.WriteFile(garbage, []byte("not a sqlite database"), 0o600); err != nil {
		t.Fatalf("write garbage file: %v", err)
	}
	dir := filepath.Join(f.Dir, "p25-a-directory")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	testsupport.RunMatrix(t, "sqlite", f, f.Config, []testsupport.Case{
		{
			Name:   "the seeded file, read-write",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig { return c },
			Expect: testsupport.Outcome{Succeed: true},
		},
		{
			Name: "the seeded file, read-only",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.ReadOnly = true
				return c
			},
			Expect: testsupport.Outcome{Succeed: true},
		},
		{
			Name: "a missing file",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Database = testsupport.Strp(missing)
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeNotFound},
		},
		{
			Name: "a garbage non-database file",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Database = testsupport.Strp(garbage)
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeConnect},
		},
		{
			Name: "a directory",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Database = testsupport.Strp(dir)
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeConnect},
		},
		{
			Name: "empty/unset database field",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				empty := ""
				c.Database = &empty
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeConnect},
		},
		{
			// client.go's own comment: net/url.Parse's Path comes back one leading slash short of
			// the real absolute path, so the URI needs four slashes after the scheme, not three.
			Name: "uri mode, sqlite:////abs/path",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Mode = "uri"
				c.URI = testsupport.Strp("sqlite:///" + f.Path)
				return c
			},
			Expect: testsupport.Outcome{Succeed: true},
		},
		{
			Name: "uri mode, no path",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Mode = "uri"
				c.URI = testsupport.Strp("sqlite://")
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeConnect},
		},
	})
}
