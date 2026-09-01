package sqlite

import (
	"net/url"
	"os"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// busyTimeoutMS is client.ts's BUSY_TIMEOUT_MS — node:sqlite's own default is 0 (fail immediately
// on a lock); 5s matches storage/db.ts's own `PRAGMA busy_timeout` for Kira's app database.
const busyTimeoutMS = "5000"

// resolveFilePath is client.ts's resolveFilePath. D10/D13: fields mode repurposes `database` for
// the absolute path (F27); URI mode's `sqlite:////abs/path` already round-trips through
// net/url.Parse the same way parseConnectionUri's own new URL(uri) does — u.Path comes back
// "//abs/path", one leading slash short of the real path, exactly like JS's url.pathname does.
// One divergence from the TS port, not a bug: Go's net/url.Parse already percent-decodes Path,
// unlike JS's URL.pathname (which never decodes it — client.ts calls decodeURIComponent itself for
// exactly that reason). Decoding here too would double-decode a literal "%" in a real path, so this
// does not call url.PathUnescape a second time.
func resolveFilePath(cfg model.ResolvedConnectionConfig) (string, error) {
	if cfg.Mode == "uri" && cfg.URI != nil && *cfg.URI != "" {
		u, err := url.Parse(*cfg.URI)
		if err != nil {
			return "", adapters.New(adapters.CodeConnect, "could not parse the connection URI", err)
		}
		path := strings.TrimPrefix(u.Path, "/")
		if path == "" {
			return "", adapters.New(adapters.CodeConnect, "could not parse the connection URI", nil)
		}
		return path, nil
	}
	path := ""
	if cfg.Database != nil {
		path = strings.TrimSpace(*cfg.Database)
	}
	if path == "" {
		return "", adapters.New(adapters.CodeConnect, "no database file path was given", nil)
	}
	return path, nil
}

// assertFileExists is client.ts's assertFileExists — D8: Kira never creates a database. A plain
// DSN open would also silently create an empty file at path when nothing is there (verified: see
// buildDSN's own mode=ro/mode=rw comment) — the worst failure mode for a tool whose own promise is
// that DDL is read-only. Checked before the driver ever touches the path, so a typo fails as
// E_NOT_FOUND rather than "connecting" to a database Kira itself just created.
func assertFileExists(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return adapters.New(adapters.CodeNotFound, "no database file at \""+path+"\"", nil)
	}
	if !info.Mode().IsRegular() {
		return adapters.New(adapters.CodeConnect, "\""+path+"\" is not a regular file", nil)
	}
	return nil
}

// buildDSN is client.ts's own DSN construction, minus the options node:sqlite took as a struct —
// modernc.org/sqlite takes everything through the DSN's query string instead (B7). `mode=ro`/
// `mode=rw`, never `rwc`: SQLite's own URI filename parsing honours `mode` directly (verified: a
// missing file under `mode=ro` or `mode=rw` fails immediately as SQLITE_CANTOPEN and creates
// nothing; the default no-mode DSN silently creates the file, which is exactly why
// assertFileExists runs first as the primary defence and this is only the second line of it, D8).
func buildDSN(path string, readOnly bool) string {
	q := url.Values{}
	q.Set("_busy_timeout", busyTimeoutMS)
	q.Set("_foreign_keys", "1")
	q.Set("_txlock", "immediate")
	if readOnly {
		q.Set("_query_only", "1")
		q.Set("mode", "ro")
	} else {
		q.Set("mode", "rw")
	}
	return "file:" + path + "?" + q.Encode()
}
