package redis

import (
	"context"
	"crypto/tls"
	"fmt"
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
	sslmode, hasSslmode := cfg.Options["sslmode"].(string)
	switch {
	case hasSslmode && sslmode != "" && sslmode != "disable":
		switch sslmode {
		// Unlike Postgres's "require" (encrypt only, no verification — a libpq convention this
		// app has no reason to inherit for Redis), require/prefer/verify-full all verify here,
		// matching the Kafka adapter's own reasoning: "require" without verification accepts any
		// certificate, including an attacker's, with no indication anywhere in the UI.
		case "require", "prefer", "verify-full":
			tlsConfig = &tls.Config{ServerName: host}
		case "verify-none", "insecure":
			tlsConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // explicit opt-out, not the default
		default:
			// An unrecognized sslmode must fail loudly rather than silently fall back to a
			// plaintext connection — a typo here would otherwise send credentials and data
			// unencrypted while the user believes TLS is configured.
			return connectFields{}, 0, adapters.New(adapters.CodeConnect, `redis: unknown sslmode "`+sslmode+`"`, nil)
		}
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
// SELECT.
type dbConnectionSet struct {
	fields         connectFields
	defaultDbIndex int
	log            func(level, message string)

	mu          sync.Mutex
	connections map[int]*goredis.Client
	lru         []int
	// P21 round 3 performance finding 5(b), porting postgres/client.go's own round-2 single-flight
	// fix (mirrored into mysqlfamily/client.go too): keyed by the same key as connections — a dial
	// in progress for a not-yet-open db index, so a second concurrent get() for it waits on this
	// dial's own outcome instead of starting a duplicate one. Without this, two concurrent get()
	// calls for the same not-yet-open db index (routine — expanding a namespace while a tab loads
	// from it) both dialed, and the second overwrote the first in connections: a leaked
	// *goredis.Client and its whole connection pool for the life of the app.
	dialing map[int]*dialInFlight

	cmdMu   sync.Mutex
	cmdInfo map[string]*goredis.CommandInfo
}

// dialInFlight is one in-progress get() dial for a db index — see postgres/client.go's own doc
// comment on the identical type; the semantics here are byte-for-byte the same.
type dialInFlight struct {
	done chan struct{}
}

func newDbConnectionSet(fields connectFields, defaultDbIndex int, log func(level, message string)) *dbConnectionSet {
	return &dbConnectionSet{
		fields: fields, defaultDbIndex: defaultDbIndex, log: log,
		connections: make(map[int]*goredis.Client),
		dialing:     make(map[int]*dialInFlight),
	}
}

// get returns dbIndex's connection, opening one if none exists yet and evicting the
// least-recently-used non-default entry first if the set is full.
//
// P21 round 3 performance finding 5, porting postgres/client.go's own round-2 fixes: (a)
// detachLRULocked below only touches the map/lru under s.mu, closing the victim's connection after
// releasing it — a goredis.Client has no per-connection lock to hold (unlike postgres/mysqlfamily's
// pinned single connection, a real *redis.Client is already safe for concurrent use and pools its
// own connections), so this half is a smaller win here, but the shape stays consistent with the
// other two adapters. (b) the dialing map above turns the dial into a single-flight: the first
// caller for a key dials while holding a placeholder; everyone else waits on that placeholder's own
// outcome instead of starting a duplicate dial.
func (s *dbConnectionSet) get(ctx context.Context, dbIndex int) (*goredis.Client, error) {
	for {
		s.mu.Lock()
		if existing, ok := s.connections[dbIndex]; ok {
			s.touchLocked(dbIndex)
			s.mu.Unlock()
			return existing, nil
		}
		if inFlight, ok := s.dialing[dbIndex]; ok {
			s.mu.Unlock()
			select {
			case <-inFlight.done:
				// Re-check from the top, exactly as postgres/client.go's get() does — see its own
				// comment for why this can never spin on a reused key.
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		// This goroutine is now the one dialing dbIndex — every concurrent caller for the same
		// index takes the branch above instead, until waiter.done closes.
		waiter := &dialInFlight{done: make(chan struct{})}
		s.dialing[dbIndex] = waiter
		var victim *goredis.Client
		// Counting in-flight dials against maxConnections too closes the same "related, minor" gap
		// postgres/client.go's own comment names: without it, N concurrent first-time opens could
		// all pass this check before any of them finished dialing, transiently exceeding the cap.
		if len(s.connections)+len(s.dialing) > maxConnections {
			victim = s.detachLRULocked()
		}
		s.mu.Unlock()

		if victim != nil {
			_ = victim.Close()
		}

		client, err := s.dial(ctx, dbIndex)

		s.mu.Lock()
		delete(s.dialing, dbIndex)
		if err == nil {
			s.connections[dbIndex] = client
			s.touchLocked(dbIndex)
		}
		s.mu.Unlock()

		close(waiter.done)
		return client, err
	}
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
		Addr:     fmt.Sprintf("%s:%d", s.fields.host, s.fields.port),
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
	s.mu.Lock()
	all := make([]*goredis.Client, 0, len(s.connections))
	for _, c := range s.connections {
		all = append(all, c)
	}
	s.connections = make(map[int]*goredis.Client)
	s.lru = nil
	s.mu.Unlock()
	for _, c := range all {
		_ = c.Close()
	}
}

func (s *dbConnectionSet) touchLocked(key int) {
	for i, k := range s.lru {
		if k == key {
			s.lru = append(s.lru[:i], s.lru[i+1:]...)
			break
		}
	}
	s.lru = append(s.lru, key)
}

// detachLRULocked picks the least-recently-used non-default db index to make room, removes it
// from the map/lru under s.mu, and returns it for the caller to close *after* releasing s.mu — the
// default db index is never evicted (client.ts:141-149). A no-op (nil) if every open connection is
// the default.
func (s *dbConnectionSet) detachLRULocked() *goredis.Client {
	victimIdx := -1
	for i, key := range s.lru {
		if key != s.defaultDbIndex {
			victimIdx = i
			break
		}
	}
	if victimIdx < 0 {
		return nil
	}
	victimKey := s.lru[victimIdx]
	s.lru = append(s.lru[:victimIdx], s.lru[victimIdx+1:]...)
	victim := s.connections[victimKey]
	delete(s.connections, victimKey)
	return victim
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
