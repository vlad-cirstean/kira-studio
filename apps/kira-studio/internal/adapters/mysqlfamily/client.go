package mysqlfamily

import (
	"context"
	"crypto/tls"
	"database/sql"
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
		for key, values := range parsed.Query() {
			if len(values) == 0 {
				continue
			}
			if mc.Params == nil {
				mc.Params = map[string]string{}
			}
			mc.Params[key] = values[0]
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

	if sslmode, ok := cfg.Options["sslmode"].(string); ok && sslmode != "" && sslmode != "disable" {
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

func parseHost(addr string) string {
	host, _, err := splitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}

func splitHostPort(addr string) (host, port string, err error) {
	idx := strings.LastIndex(addr, ":")
	if idx < 0 {
		return addr, "", nil
	}
	return addr[:idx], addr[idx+1:], nil
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
	dbs   map[string]*sql.DB
	conns map[string]*sql.Conn
	tids  map[string]uint32
	lru   []string
}

// NewConnSet constructs a ConnSet for cfg.
func NewConnSet(cfg model.ResolvedConnectionConfig, profile Profile, log LogFunc) *ConnSet {
	return &ConnSet{
		cfg: cfg, profile: profile, log: log,
		dbs: make(map[string]*sql.DB), conns: make(map[string]*sql.Conn), tids: make(map[string]uint32),
	}
}

// Entry is one pinned connection plus its own server-assigned thread id, cached at Get time (the
// Go-only addition query.ts's own RunningQuery gets for free from the driver's own conn.threadId).
type Entry struct {
	Conn     *sql.Conn
	ThreadID uint32
}

// Get returns the pinned connection for database (empty string means the primary), opening one if
// none exists yet and evicting the least-recently-used non-primary entry first if the set is full.
func (s *ConnSet) Get(ctx context.Context, database string) (Entry, error) {
	key := database
	if key == "" {
		key = primaryKey
	}

	s.mu.Lock()
	if conn, ok := s.conns[key]; ok {
		s.touchLocked(key)
		entry := Entry{Conn: conn, ThreadID: s.tids[key]}
		s.mu.Unlock()
		return entry, nil
	}
	if len(s.conns) >= maxConns {
		s.evictLRULocked(ctx)
	}
	s.mu.Unlock()

	mc, err := BuildConfig(s.cfg, database, s.profile, s.log)
	if err != nil {
		return Entry{}, err
	}
	connector, err := mysql.NewConnector(mc)
	if err != nil {
		return Entry{}, mapError(err)
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	conn, err := db.Conn(ctx)
	if err != nil {
		_ = db.Close()
		return Entry{}, mapError(err)
	}
	var threadID uint32
	if err := conn.QueryRowContext(ctx, "SELECT CONNECTION_ID()").Scan(&threadID); err != nil {
		_ = conn.Close()
		_ = db.Close()
		return Entry{}, mapError(err)
	}

	// A read-only connection is enforced by the server itself, not just Mutate's own app-level
	// AssertWritable check — matching ClickHouse's readonly=2 and SQLite's mode=ro precedent, and
	// closing the gap the console's Execute() would otherwise leave (it has no per-statement
	// write/read classifier of its own, unlike Redis/Mongo's console).
	if s.cfg.ReadOnly {
		if _, err := conn.ExecContext(ctx, "SET SESSION TRANSACTION READ ONLY"); err != nil {
			_ = conn.Close()
			_ = db.Close()
			return Entry{}, mapError(err)
		}
	}

	s.mu.Lock()
	s.dbs[key] = db
	s.conns[key] = conn
	s.tids[key] = threadID
	s.touchLocked(key)
	s.mu.Unlock()
	return Entry{Conn: conn, ThreadID: threadID}, nil
}

// Primary returns the primary (no explicit database override) connection.
func (s *ConnSet) Primary(ctx context.Context) (Entry, error) {
	return s.Get(ctx, "")
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

// evictLRULocked evicts the least-recently-used non-primary entry to make room.
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
	conn, db := s.conns[victimKey], s.dbs[victimKey]
	delete(s.conns, victimKey)
	delete(s.dbs, victimKey)
	delete(s.tids, victimKey)
	for i, k := range s.lru {
		if k == victimKey {
			s.lru = append(s.lru[:i], s.lru[i+1:]...)
			break
		}
	}
	if conn != nil {
		_ = conn.Close()
	}
	if db != nil {
		_ = db.Close()
	}
}

// CloseAll closes every open connection.
func (s *ConnSet) CloseAll(ctx context.Context) {
	s.mu.Lock()
	conns := make([]*sql.Conn, 0, len(s.conns))
	for _, c := range s.conns {
		conns = append(conns, c)
	}
	dbs := make([]*sql.DB, 0, len(s.dbs))
	for _, d := range s.dbs {
		dbs = append(dbs, d)
	}
	s.conns = make(map[string]*sql.Conn)
	s.dbs = make(map[string]*sql.DB)
	s.tids = make(map[string]uint32)
	s.lru = nil
	s.mu.Unlock()

	for _, c := range conns {
		_ = c.Close()
	}
	for _, d := range dbs {
		_ = d.Close()
	}
}
