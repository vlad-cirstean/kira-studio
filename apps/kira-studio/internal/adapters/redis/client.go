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

	if cfg.Mode == "uri" && cfg.URI != nil && *cfg.URI != "" {
		u, err := url.Parse(*cfg.URI)
		if err != nil {
			return connectFields{}, 0, adapters.New(adapters.CodeConnect, "could not parse the connection URI", err)
		}
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
	if sslmode, ok := cfg.Options["sslmode"].(string); ok && sslmode != "" && sslmode != "disable" {
		switch sslmode {
		case "require", "prefer":
			tlsConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // matches client.ts's own rejectUnauthorized:false for these two modes
		case "verify-full":
			tlsConfig = &tls.Config{ServerName: host}
		default:
			// An unrecognized sslmode must fail loudly rather than silently fall back to a
			// plaintext connection — a typo here would otherwise send credentials and data
			// unencrypted while the user believes TLS is configured.
			return connectFields{}, 0, adapters.New(adapters.CodeConnect, `redis: unknown sslmode "`+sslmode+`"`, nil)
		}
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

	cmdMu   sync.Mutex
	cmdInfo map[string]*goredis.CommandInfo
}

func newDbConnectionSet(fields connectFields, defaultDbIndex int, log func(level, message string)) *dbConnectionSet {
	return &dbConnectionSet{
		fields: fields, defaultDbIndex: defaultDbIndex, log: log,
		connections: make(map[int]*goredis.Client),
	}
}

func (s *dbConnectionSet) get(ctx context.Context, dbIndex int) (*goredis.Client, error) {
	s.mu.Lock()
	if existing, ok := s.connections[dbIndex]; ok {
		s.touchLocked(dbIndex)
		s.mu.Unlock()
		return existing, nil
	}
	if len(s.connections) >= maxConnections {
		s.evictLRULocked()
	}
	s.mu.Unlock()

	opts := &goredis.Options{
		Addr:        fmt.Sprintf("%s:%d", s.fields.host, s.fields.port),
		Username:    s.fields.username,
		Password:    s.fields.password,
		DB:          dbIndex,
		ClientName:  "kira-studio",
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
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, mapError(err)
	}

	s.mu.Lock()
	s.connections[dbIndex] = client
	s.touchLocked(dbIndex)
	s.mu.Unlock()
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

// evictLRULocked never evicts the primary (client.ts:141-149).
func (s *dbConnectionSet) evictLRULocked() {
	victimIdx := -1
	for i, key := range s.lru {
		if key != s.defaultDbIndex {
			victimIdx = i
			break
		}
	}
	if victimIdx < 0 {
		return
	}
	victimKey := s.lru[victimIdx]
	s.lru = append(s.lru[:victimIdx], s.lru[victimIdx+1:]...)
	if victim, ok := s.connections[victimKey]; ok {
		delete(s.connections, victimKey)
		_ = victim.Close()
	}
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
