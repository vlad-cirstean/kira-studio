package mysqlfamily

import (
	"context"
	"crypto/tls"
	"database/sql"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-sql-driver/mysql"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

const (
	connectTimeout = 10 * time.Second
	maxConns       = 8
	// primaryKey is a key no real database name can collide with.
	primaryKey = "\x00primary"
)

// BuildConfig is client.ts's buildConnectionOptions. database overrides cfg's own database when
// non-empty (a side database Get() call).
func BuildConfig(cfg model.ResolvedConnectionConfig, database string, profile Profile, log LogFunc) (*mysql.Config, error) {
	mc := mysql.NewConfig()
	mc.Net = "tcp"
	// B2: the text protocol, matching pgx.QueryExecModeSimpleProtocol's own reasoning — the driver
	// hands back the server's own bytes, not a re-typed Go value.
	mc.InterpolateParams = true
	mc.ParseTime = false
	mc.MultiStatements = false
	mc.AllowNativePasswords = true
	// P2 R2: without CLIENT_FOUND_ROWS, MySQL/MariaDB report "rows changed" from an UPDATE, not
	// "rows matched" — so editing a cell back to the value it already had returns affectedRows=0,
	// which mutate()'s AssertAffectedExactlyOne(kind, 0) then rejects as a failed update, rolling
	// back the whole batch even though the row was found and the statement succeeded. Postgres and
	// SQLite both report rows matched natively; this flag is what makes MySQL/MariaDB consistent
	// with them (the old TS client got this for free — the mariadb connector's own foundRows option
	// defaults to true).
	mc.ClientFoundRows = true
	// B23: the Go analogue of connectAttributes: { program_name: 'kira-studio' }.
	mc.ConnectionAttributes = "program_name:kira-studio"
	mc.Timeout = connectTimeout

	// options is what the sslmode switch below reads from. In fields mode it's exactly cfg.Options
	// (populated by the renderer). In URI mode we start from cfg.Options too (for parity, though the
	// renderer only populates it on a fields<->URI flip) and layer in the URI's own query string —
	// but only the keys this adapter actually understands, translated into real config, never handed
	// to the driver as literal session-variable text (see below).
	options := map[string]any{}
	for k, v := range cfg.Options {
		options[k] = v
	}

	if cfg.Mode == "uri" && cfg.URI != nil && *cfg.URI != "" {
		parsed, err := url.Parse(*cfg.URI)
		if err != nil {
			return nil, adapters.New(adapters.CodeConnect, "could not parse the connection URI", err)
		}
		mc.Addr = parsed.Host
		if mc.Addr == "" {
			mc.Addr = "127.0.0.1:3306"
		} else if parsed.Port() == "" {
			mc.Addr += ":3306"
		}
		if u := parsed.User; u != nil {
			mc.User = u.Username()
			if pw, ok := u.Password(); ok {
				mc.Passwd = pw
			}
		}
		mc.DBName = strings.TrimPrefix(parsed.Path, "/")
		// The driver's own Params field is not a bag of DSN options: go-sql-driver concatenates
		// every entry into a literal `SET <k> = <v>, ...` and executes it verbatim at connect time
		// (handleParams). Splicing an arbitrary URI query string into that would both break the
		// only documented TLS path for these two engines (?sslmode=... would try `SET sslmode =
		// ...` and fail with "Unknown system variable") and run unescaped user text as SQL. So only
		// translate known keys into real config; everything else is dropped with a warn log rather
		// than forwarded to the driver.
		for key, values := range parsed.Query() {
			if len(values) == 0 {
				continue
			}
			switch key {
			case "sslmode":
				options["sslmode"] = values[0]
			default:
				if log != nil {
					log("warn", "mysql-family: ignoring unrecognized connection URI option \""+key+"\"")
				}
			}
		}
	} else {
		host := ""
		if cfg.Host != nil {
			host = *cfg.Host
		}
		port := 3306
		if cfg.Port != nil {
			port = *cfg.Port
		}
		mc.Addr = host + ":" + strconv.Itoa(port)
		if cfg.Username != nil {
			mc.User = *cfg.Username
		}
		if cfg.Password != nil {
			mc.Passwd = *cfg.Password
		}
		if cfg.Database != nil {
			mc.DBName = *cfg.Database
		}
	}
	if database != "" {
		mc.DBName = database
	}

	if sslmode, ok := options["sslmode"].(string); ok && sslmode != "" && sslmode != "disable" {
		tlsName := "kira-" + cfg.ID
		switch sslmode {
		case "require", "prefer":
			if err := mysql.RegisterTLSConfig(tlsName, &tls.Config{InsecureSkipVerify: true}); err != nil { //nolint:gosec // matches client.ts's own rejectUnauthorized:false for these two modes
				return nil, err
			}
			mc.TLSConfig = tlsName
		case "verify-full":
			if err := mysql.RegisterTLSConfig(tlsName, &tls.Config{ServerName: parseHost(mc.Addr)}); err != nil {
				return nil, err
			}
			mc.TLSConfig = tlsName
		default:
			// An unrecognized sslmode must fail loudly rather than silently fall back to a
			// plaintext connection — a typo here would otherwise send credentials and data
			// unencrypted while the user believes TLS is configured.
			return nil, adapters.New(adapters.CodeConnect, "mysql-family: unknown sslmode \""+sslmode+"\"", nil)
		}
	}

	profile.ApplyEngineOptions(mc, cfg, log)

	return mc, nil
}

// parseHost extracts the bare host from a "host:port" address for use as a TLS ServerName.
// P21 round 2 architecture/security finding 8: a hand-rolled strings.LastIndex split used to be
// used here instead of the standard library's net.SplitHostPort — for a URI-mode IPv6 address
// (net/url.Parse's own Host field, e.g. "[::1]:3306"), that returned ServerName = "[::1]",
// brackets included, which cannot match any certificate (a real server's certificate names the
// bare address, "::1", never the bracketed literal). net.SplitHostPort strips the brackets
// correctly, matching how every other Go TLS ServerName in this codebase is derived.
func parseHost(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		// A port-less address (net.SplitHostPort's own "missing port in address") is passed
		// through unchanged, matching this function's original tolerant behaviour.
		return addr
	}
	return host
}

// connEntry pairs one database's pinned *sql.Conn with the mutex that serializes every use of it
// (P21 round 2 performance finding 3, mirroring postgres/client.go's own connEntry): a *sql.Conn
// is not safe for concurrent use by multiple goroutines any more than a *pgx.Conn is, but nothing
// above this package serializes ops against the same Adapter — adapterhost dispatches each inbound
// frame on its own goroutine (bounded only by the session's own in-flight cap), so two Reads on two
// tabs, or a Read racing a console Execute, can and do reach the same pinned connection
// concurrently without this lock, which go-sql-driver on a single-conn *sql.DB (SetMaxOpenConns(1))
// surfaces as a busy-buffer/bad-connection error rather than silently corrupting anything — still a
// real, user-visible failure with no cause the error message names.
type connEntry struct {
	db       *sql.DB
	conn     *sql.Conn
	threadID uint32
	mu       sync.Mutex
}

// ConnSet is client.ts's ConnectionSet (B5, mirrors postgres/client.go's ConnSet): one *sql.DB per
// (connection, database), each bounded to a single open connection (SetMaxOpenConns(1)) so a
// pinned *sql.Conn — never a pool — is what every query in this package actually runs against.
// KILL QUERY needs a known thread id, which a pool does not reliably give you.
type ConnSet struct {
	cfg     model.ResolvedConnectionConfig
	profile Profile
	log     LogFunc

	mu    sync.Mutex
	conns map[string]*connEntry
	lru   []string
}

// NewConnSet constructs a ConnSet for cfg.
func NewConnSet(cfg model.ResolvedConnectionConfig, profile Profile, log LogFunc) *ConnSet {
	return &ConnSet{cfg: cfg, profile: profile, log: log, conns: make(map[string]*connEntry)}
}

// Entry is one pinned connection plus its own server-assigned thread id, cached at Acquire time
// (the Go-only addition query.ts's own RunningQuery gets for free from the driver's own
// conn.threadId).
type Entry struct {
	Conn     *sql.Conn
	ThreadID uint32
}

// get returns the entry for database (empty string means the primary), opening one if none exists
// yet and evicting the least-recently-used non-primary entry first if the set is full.
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

	mc, err := BuildConfig(s.cfg, database, s.profile, s.log)
	if err != nil {
		return nil, err
	}
	connector, err := mysql.NewConnector(mc)
	if err != nil {
		return nil, mapError(err)
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	conn, err := db.Conn(ctx)
	if err != nil {
		_ = db.Close()
		return nil, mapError(err)
	}
	var threadID uint32
	if err := conn.QueryRowContext(ctx, "SELECT CONNECTION_ID()").Scan(&threadID); err != nil {
		_ = conn.Close()
		_ = db.Close()
		return nil, mapError(err)
	}

	// A read-only connection is enforced by the server itself, not just Mutate's own app-level
	// AssertWritable check — matching ClickHouse's readonly=2 and SQLite's mode=ro precedent, and
	// closing the gap the console's Execute() would otherwise leave (it has no per-statement
	// write/read classifier of its own, unlike Redis/Mongo's console).
	if s.cfg.ReadOnly {
		if _, err := conn.ExecContext(ctx, "SET SESSION TRANSACTION READ ONLY"); err != nil {
			_ = conn.Close()
			_ = db.Close()
			return nil, mapError(err)
		}
	}

	entry := &connEntry{db: db, conn: conn, threadID: threadID}
	s.mu.Lock()
	s.conns[key] = entry
	s.touchLocked(key)
	s.mu.Unlock()
	return entry, nil
}

// Acquire returns database's connection (empty string means the primary) together with a release
// func that must be called exactly once, however the caller's own use of it ends — it holds the
// per-connection lock connEntry's own doc comment describes, for the caller's own entire op, not
// just one statement: a Mutate's several sequential statements or a console Execute's "run all"
// must keep any concurrent op off this same conn for its whole duration, not just between
// individual statements, or a racing Read could execute between two of them (P21 round 2
// performance finding 3, mirroring postgres/client.go's own Acquire and its identical reasoning).
func (s *ConnSet) Acquire(ctx context.Context, database string) (Entry, func(), error) {
	entry, err := s.get(ctx, database)
	if err != nil {
		return Entry{}, nil, err
	}
	entry.mu.Lock()
	return Entry{Conn: entry.conn, ThreadID: entry.threadID}, entry.mu.Unlock, nil
}

// Primary acquires the primary (no explicit database override) connection.
func (s *ConnSet) Primary(ctx context.Context) (Entry, func(), error) {
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

// evictLRULocked evicts the least-recently-used non-primary entry to make room, taking the
// victim's own lock first (P21 round 2 performance finding 3 — see connEntry's own comment).
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
		_ = victim.conn.Close()
		_ = victim.db.Close()
	}
}

// CloseAll closes every open connection, taking each one's own lock first (P21 round 2 performance
// finding 3 — see evictLRULocked's own comment).
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
		_ = e.conn.Close()
		_ = e.db.Close()
		e.mu.Unlock()
	}
}
