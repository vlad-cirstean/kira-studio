package postgres

import (
	"context"
	"crypto/tls"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

const (
	connectTimeout = 10 * time.Second
	maxConns       = 8
	// primaryKey is a key no real database name can collide with — NUL can't appear in a
	// Postgres identifier.
	primaryKey = "\x00primary"
)

// buildConfig is client.ts's buildClientConfig.
func buildConfig(cfg model.ResolvedConnectionConfig, database string, log func(level, message string)) (*pgx.ConnConfig, error) {
	var connConfig *pgx.ConnConfig
	if cfg.Mode == "uri" && cfg.URI != nil && *cfg.URI != "" {
		parsed, err := pgx.ParseConfig(*cfg.URI)
		if err != nil {
			return nil, err
		}
		connConfig = parsed
	} else {
		parsed, err := pgx.ParseConfig("")
		if err != nil {
			return nil, err
		}
		connConfig = parsed
		if cfg.Host != nil {
			connConfig.Host = *cfg.Host
		}
		if cfg.Port != nil {
			connConfig.Port = uint16(*cfg.Port)
		}
		if cfg.Username != nil {
			connConfig.User = *cfg.Username
		}
		if cfg.Password != nil {
			connConfig.Password = *cfg.Password
		}
	}
	if database != "" {
		connConfig.Database = database
	} else if cfg.Database != nil {
		connConfig.Database = *cfg.Database
	}

	connConfig.ConnectTimeout = connectTimeout
	if connConfig.RuntimeParams == nil {
		connConfig.RuntimeParams = map[string]string{}
	}
	connConfig.RuntimeParams["application_name"] = "kira-studio"
	// The app cancels explicitly via pg_cancel_backend; a silent server-side statement_timeout
	// would make the stop button's contract a lie.
	connConfig.RuntimeParams["statement_timeout"] = "0"

	if sslmode, ok := cfg.Options["sslmode"].(string); ok && sslmode != "" && sslmode != "disable" {
		switch sslmode {
		case "require", "prefer":
			connConfig.TLSConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // matches client.ts's own rejectUnauthorized:false for these two modes
		case "verify-full":
			connConfig.TLSConfig = &tls.Config{ServerName: connConfig.Host}
		default:
			// An unrecognized sslmode must fail loudly rather than silently fall back to a
			// plaintext connection — a typo here would otherwise send credentials and data
			// unencrypted while the user believes TLS is configured.
			return nil, adapters.New(adapters.CodeConnect, "postgres: unknown sslmode \""+sslmode+"\"", nil)
		}
	}

	return connConfig, nil
}

// connEntry pairs one database's *pgx.Conn with the mutex that serializes every use of it (P2 R2):
// pgx.Conn is not safe for concurrent use by multiple goroutines, but nothing above this package
// serializes ops against the same Adapter — adapterhost dispatches each inbound frame on its own
// goroutine (bounded only by the session's own in-flight cap), so two Reads on two tabs, or a Read
// racing a Mutate, can and do reach the same *pgx.Conn concurrently without this lock.
type connEntry struct {
	conn *pgx.Conn
	mu   sync.Mutex
}

// ConnSet is client.ts's ClientSet — misleadingly-named "Pool" avoided on purpose (D14): one
// *pgx.Conn per (connection, database), never a pool, because pg_cancel_backend needs a known
// backend pid and a pool does not reliably tell you which backend ran your query.
//
// The same race client.ts's own get() has is left unfixed here rather than "improved": two
// concurrent get calls for the same not-yet-open database can both miss the cache and both dial,
// with the second overwriting the first in the map (leaking the first connection) — client.ts has
// exactly this race too (JS's single-threaded interleaving around the await makes it just as
// possible there), so this is a faithful port of an existing, accepted behaviour, not a new gap.
type ConnSet struct {
	cfg model.ResolvedConnectionConfig
	log func(level, message string)

	mu    sync.Mutex
	conns map[string]*connEntry
	lru   []string
}

// NewConnSet constructs a ConnSet for cfg.
func NewConnSet(cfg model.ResolvedConnectionConfig, log func(level, message string)) *ConnSet {
	return &ConnSet{cfg: cfg, log: log, conns: make(map[string]*connEntry)}
}

// get returns the entry for database (empty string means the primary), opening a connection for it
// if none exists yet and evicting the least-recently-used non-primary connection first if the set is
// full.
func (s *ConnSet) get(ctx context.Context, database string) (*connEntry, error) {
	key := database
	if key == "" {
		key = primaryKey
	}

	s.mu.Lock()
	if existing, ok := s.conns[key]; ok {
		s.touchLocked(key)
		s.mu.Unlock()
		return existing, nil
	}
	if len(s.conns) >= maxConns {
		s.evictLRULocked(ctx)
	}
	s.mu.Unlock()

	connConfig, err := buildConfig(s.cfg, database, s.log)
	if err != nil {
		return nil, mapError(err)
	}
	conn, err := pgx.ConnectConfig(ctx, connConfig)
	if err != nil {
		return nil, mapError(err)
	}

	// A read-only connection is enforced by the server itself, not just Mutate's own app-level
	// AssertWritable check — matching ClickHouse's readonly=2 and SQLite's mode=ro precedent, and
	// closing the gap the console's Execute() would otherwise leave (it has no per-statement
	// write/read classifier of its own, unlike Redis/Mongo's console).
	if s.cfg.ReadOnly {
		if _, err := conn.Exec(ctx, "SET default_transaction_read_only = on"); err != nil {
			_ = conn.Close(ctx)
			return nil, mapError(err)
		}
	}

	entry := &connEntry{conn: conn}
	s.mu.Lock()
	s.conns[key] = entry
	s.touchLocked(key)
	s.mu.Unlock()
	return entry, nil
}

// Acquire returns database's connection (empty string means the primary) together with a release
// func that must be called exactly once, however the caller's own use of conn ends — it holds the
// per-connection lock get's own doc comment describes, for the caller's own entire op, not just one
// statement: a mutate's BEGIN…COMMIT or a console "run all" must keep any concurrent op off this
// same conn for its whole duration, not just between individual statements, or a racing Read could
// execute inside the open transaction (P2 R2).
func (s *ConnSet) Acquire(ctx context.Context, database string) (*pgx.Conn, func(), error) {
	entry, err := s.get(ctx, database)
	if err != nil {
		return nil, nil, err
	}
	entry.mu.Lock()
	return entry.conn, entry.mu.Unlock, nil
}

// Primary acquires the primary (no explicit database override) connection.
func (s *ConnSet) Primary(ctx context.Context) (*pgx.Conn, func(), error) {
	return s.Acquire(ctx, "")
}

func (s *ConnSet) touchLocked(key string) {
	for i, k := range s.lru {
		if k == key {
			s.lru = append(s.lru[:i], s.lru[i+1:]...)
			break
		}
	}
	s.lru = append(s.lru, key)
}

// evictLRULocked evicts the least-recently-used non-primary connection to make room — a user
// expanding twenty databases should not open twenty backends. A no-op if every open connection is
// the primary (never evicted). Takes the victim's own lock before closing it (P2 R2): without this,
// evicting to open a 9th database could close a conn out from under an op that is still mid-flight
// on it.
func (s *ConnSet) evictLRULocked(ctx context.Context) {
	var victimKey string
	for _, k := range s.lru {
		if k != primaryKey {
			victimKey = k
			break
		}
	}
	if victimKey == "" {
		return
	}
	victim := s.conns[victimKey]
	delete(s.conns, victimKey)
	for i, k := range s.lru {
		if k == victimKey {
			s.lru = append(s.lru[:i], s.lru[i+1:]...)
			break
		}
	}
	if victim != nil {
		victim.mu.Lock()
		defer victim.mu.Unlock()
		_ = victim.conn.Close(ctx)
	}
}

// CloseAll closes every open connection, taking each one's own lock first (P2 R2 — see
// evictLRULocked's own comment).
func (s *ConnSet) CloseAll(ctx context.Context) {
	s.mu.Lock()
	all := make([]*connEntry, 0, len(s.conns))
	for _, e := range s.conns {
		all = append(all, e)
	}
	s.conns = make(map[string]*connEntry)
	s.lru = nil
	s.mu.Unlock()

	for _, e := range all {
		e.mu.Lock()
		_ = e.conn.Close(ctx)
		e.mu.Unlock()
	}
}
