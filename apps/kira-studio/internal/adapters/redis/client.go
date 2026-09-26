package redis

import (
	"context"
	"crypto/tls"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

const (
	connectTimeout = 10 * time.Second
	maxConnections = 8
	defaultDBIndex = 0
)

type connectFields struct {
	host      string
	port      int
	username  string
	password  string
	tlsConfig *tls.Config // nil means no TLS
}

// resolveFields is client.ts's resolveFields.
func resolveFields(cfg model.ResolvedConnectionConfig, log func(level, message string)) (connectFields, int, error) {
	var host, username, password, database string
	var port int
	// uriWantsTLS is true only for the standard `rediss://` scheme — the universally documented
	// spelling for a TLS Redis connection. Previously this parser never read the scheme at all, so
	// a rediss:// URI silently connected in plaintext (with the password on the wire) whenever no
	// sslmode option happened to be set.
	uriWantsTLS := false

	if cfg.Mode == "uri" && cfg.URI != nil && *cfg.URI != "" {
		u, err := url.Parse(*cfg.URI)
		if err != nil {
			return connectFields{}, 0, adapters.New(adapters.CodeConnect, "could not parse the connection URI", err)
		}
		uriWantsTLS = u.Scheme == "rediss"
		host = u.Hostname()
		if p := u.Port(); p != "" {
			port, _ = strconv.Atoi(p)
		}
		if u.User != nil {
			username = u.User.Username()
			password, _ = u.User.Password()
		}
		database = strings.TrimPrefix(u.Path, "/")
	} else {
		if cfg.Host != nil {
			host = *cfg.Host
		}
		if cfg.Port != nil {
			port = *cfg.Port
		}
		if cfg.Username != nil {
			username = *cfg.Username
		}
		if cfg.Password != nil {
			password = *cfg.Password
		}
		if cfg.Database != nil {
			database = *cfg.Database
		}
	}
	if host == "" {
		host = "localhost"
	}
	if port == 0 {
		port = 6379
	}

	var tlsConfig *tls.Config
	sslmode, sslEnabled, err := adapters.ParseSSLMode(cfg.Options, "redis", "require", "prefer", "verify-full", "verify-none", "insecure")
	if err != nil {
		return connectFields{}, 0, err
	}
	switch {
	// Unlike Postgres's "require" (encrypt only, no verification — a libpq convention this app
	// has no reason to inherit for Redis), require/prefer/verify-full all verify here, matching
	// the Kafka adapter's own reasoning: "require" without verification accepts any certificate,
	// including an attacker's, with no indication anywhere in the UI.
	case sslEnabled && adapters.SkipsVerification(sslmode):
		tlsConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // explicit opt-out, not the default
	case sslEnabled:
		tlsConfig = &tls.Config{ServerName: host}
	case uriWantsTLS:
		tlsConfig = &tls.Config{ServerName: host}
	}

	defaultDbIndex := defaultDBIndex
	if trimmed := strings.TrimSpace(database); trimmed != "" {
		if n, err := strconv.Atoi(trimmed); err == nil && n >= 0 {
			defaultDbIndex = n
		}
	}

	return connectFields{host: host, port: port, username: username, password: password, tlsConfig: tlsConfig}, defaultDbIndex, nil
}

// dbConnectionSet mirrors client.ts's DbConnectionSet exactly, keyed by logical db index instead
// of database name (P9's D9): one distinct *redis.Client per db index, each carrying its own DB
// option baked in at construction rather than sharing one connection and issuing a runtime
// SELECT. The LRU pool with single-flight dial (P21 round 3 performance finding 5) is
// adapters.ConnSet — only Dial and the eviction Close stay dialect-specific here.
type dbConnectionSet struct {
	fields         connectFields
	defaultDbIndex int
	log            func(level, message string)

	inner *adapters.ConnSet[int, *goredis.Client]

	cmdMu   sync.Mutex
	cmdInfo map[string]*goredis.CommandInfo
}

func newDbConnectionSet(fields connectFields, defaultDbIndex int, log func(level, message string)) *dbConnectionSet {
	s := &dbConnectionSet{fields: fields, defaultDbIndex: defaultDbIndex, log: log}
	s.inner = adapters.NewConnSet(adapters.ConnSetOptions[int, *goredis.Client]{
		Dial: s.dial,
		// a goredis.Client has no per-connection lock to hold (unlike postgres/mysqlfamily's pinned
		// single connection, it is already safe for concurrent use and pools its own connections).
		Close:   func(_ context.Context, c *goredis.Client) { _ = c.Close() },
		Max:     maxConnections,
		Primary: defaultDbIndex,
	})
	return s
}

// redisPing — the exact call dial makes to verify the connection — is a package-level var (the
// same seam-by-var shape postgres/client.go's own pgxConnect and mysqlfamily/client.go's own
// mysqlNewConnector establish) so a test can substitute a fake with a controlled delay and outcome,
// with no real network dial needed, to observe get()'s own single-flight behavior under genuine
// goroutine concurrency. goredis.NewClient itself never dials — go-redis connects lazily on first
// use — so Ping is the one real network round trip dial makes.
var redisPing = func(ctx context.Context, client *goredis.Client) error {
	return client.Ping(ctx).Err()
}

// dial is get()'s own single-attempt dial, split out so get() can call it with no lock held —
// redisPing is a real network round trip, the whole point of the dialing placeholder above.
func (s *dbConnectionSet) dial(ctx context.Context, dbIndex int) (*goredis.Client, error) {
	opts := &goredis.Options{
		// F13b: net.JoinHostPort brackets an IPv6 literal correctly — a bare "%s:%d" produces an
		// invalid address for one (Kafka's own adapter already does this correctly).
		Addr:     net.JoinHostPort(s.fields.host, strconv.Itoa(s.fields.port)),
		Username: s.fields.username,
		Password: s.fields.password,
		DB:       dbIndex,
		// P25 §1.3: ClientName (CLIENT SETNAME, issued by go-redis on every new pooled connection)
		// requires a privilege a least-privilege ACL user (~* +@read, or +@all -@dangerous before
		// the fix above) may not have, and it only labels the connection in CLIENT LIST — go-redis
		// offers no "tolerate a failed SETNAME" switch, so dropping the option entirely is the
		// library-supported way to stop requiring the privilege.
		DialTimeout: connectTimeout,
		// C10: RESP2, not the client library's own RESP3 default — HGETALL/CONFIG GET and
		// friends return a flat array under RESP2 and a map under RESP3, and this adapter's
		// generic per-type readers are written against the RESP2 array shape.
		Protocol: 2,
	}
	if s.fields.tlsConfig != nil {
		opts.TLSConfig = s.fields.tlsConfig
	}
	client := goredis.NewClient(opts)
	if err := redisPing(ctx, client); err != nil {
		_ = client.Close()
		return nil, mapError(err)
	}
	return client, nil
}

// get returns dbIndex's connection, opening one via adapters.ConnSet if none exists yet.
func (s *dbConnectionSet) get(ctx context.Context, dbIndex int) (*goredis.Client, error) {
	return s.inner.Get(ctx, dbIndex)
}

func (s *dbConnectionSet) primary(ctx context.Context) (*goredis.Client, error) {
	return s.get(ctx, s.defaultDbIndex)
}

// isReadOnlyCommand answers the read-only guard by asking Redis's own COMMAND table rather than
// hand-maintaining a read/write command list — the server is authoritative, including for Lua
// scripts (EVAL/EVALSHA/FCALL) and admin commands, which COMMAND INFO already flags as non-readonly.
// The table is fetched once per connection set and cached; command flags don't change mid-session.
// An unrecognized command name is treated as a write (deny by default) rather than assumed safe.
func (s *dbConnectionSet) isReadOnlyCommand(ctx context.Context, client *goredis.Client, name string) bool {
	s.cmdMu.Lock()
	defer s.cmdMu.Unlock()
	if s.cmdInfo == nil {
		info, err := client.Command(ctx).Result()
		if err != nil {
			// Can't consult the table — fail closed rather than let an unverifiable command run.
			return false
		}
		s.cmdInfo = info
	}
	info, ok := s.cmdInfo[strings.ToLower(name)]
	return ok && info.ReadOnly
}

func (s *dbConnectionSet) closeAll() {
	s.inner.CloseAll(context.Background())
}

// connectRedis is client.ts's connectRedis.
func connectRedis(ctx context.Context, cfg model.ResolvedConnectionConfig, log func(level, message string)) (*dbConnectionSet, int, error) {
	fields, defaultDbIndex, err := resolveFields(cfg, log)
	if err != nil {
		return nil, 0, err
	}
	set := newDbConnectionSet(fields, defaultDbIndex, log)
	if _, err := set.primary(ctx); err != nil { // eagerly validates the connection
		return nil, 0, err
	}
	return set, defaultDbIndex, nil
}
