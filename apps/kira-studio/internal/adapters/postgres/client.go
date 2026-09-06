package postgres

import (
	"context"
	"crypto/tls"
	"crypto/x509"
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
	} else if cfg.Database != nil && *cfg.Database != "" {
		connConfig.Database = *cfg.Database
	} else if connConfig.Database == "" {
		// P24: no explicit database anywhere (cfg.Database blank, and neither the URI's own path
		// nor pgx.ParseConfig("")'s PGDATABASE fallback supplied one). Left alone, the Postgres
		// wire protocol defaults an omitted "database" startup parameter to the connecting
		// *user* name (pgconn's own SendStartupMessage — client.go's non-URI branch above never
		// sets one either) — which fails outright with "database \"<user>\" does not exist" for
		// any real least-privilege role whose name doesn't happen to match an existing database.
		// "postgres" is the maintenance database every real server ships with, and the sane
		// bootstrap target anyway: this connection's whole point is to enumerate every database
		// on the server (docs/ARCHITECTURE.md's Postgres tree, database -> schema -> table), not
		// to land in one particular one.
		connConfig.Database = "postgres"
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
		// P21 round 2 architecture/security finding 7: pgx.ParseConfig already resolves
		// verify-ca correctly from a URI's own ?sslmode= (libpq's "verify the CA chain but not
		// the hostname" — the standard case for an internal CA or an IP-addressed host), but this
		// Options-driven override then re-read the same value and hit the default branch,
		// overriding a config pgx had already gotten right with a hard "unknown sslmode" refusal.
		// InsecureSkipVerify plus a VerifyPeerCertificate that chains against the system roots
		// without checking the hostname is the standard Go recipe for "verify-CA-not-host".
		case "verify-ca":
			connConfig.TLSConfig = &tls.Config{
				InsecureSkipVerify: true, //nolint:gosec // hostname check is intentionally skipped; chain verification still runs below
				VerifyPeerCertificate: func(certs [][]byte, _ [][]*x509.Certificate) error {
					return verifyChainSkipHostname(certs, nil) // nil roots = the system trust store
				},
			}
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

// verifyChainSkipHostname is sslmode=verify-ca's certificate check, split out of buildConfig so
// it can be tested against a controlled root pool rather than only the live system trust store
// (which a test can't add a throwaway CA to). roots == nil means "the system trust store", the
// same as x509.VerifyOptions' own zero value and what production always passes.
func verifyChainSkipHostname(rawCerts [][]byte, roots *x509.CertPool) error {
	chain := make([]*x509.Certificate, 0, len(rawCerts))
	for _, raw := range rawCerts {
		cert, err := x509.ParseCertificate(raw)
		if err != nil {
			return err
		}
		chain = append(chain, cert)
	}
	if len(chain) == 0 {
		return adapters.New(adapters.CodeConnect, "postgres: server presented no certificate", nil)
	}
	opts := x509.VerifyOptions{Roots: roots, Intermediates: x509.NewCertPool()}
	for _, cert := range chain[1:] {
		opts.Intermediates.AddCert(cert)
	}
	_, err := chain[0].Verify(opts)
	return err
}

// ConnSet is client.ts's ClientSet — misleadingly-named "Pool" avoided on purpose (D14): one
// *pgx.Conn per (connection, database), never a pool, because pg_cancel_backend needs a known
// backend pid and a pool does not reliably tell you which backend ran your query.
type ConnSet struct {
	cfg model.ResolvedConnectionConfig
	log func(level, message string)

	mu    sync.Mutex
	conns map[string]*connEntry
	lru   []string
	// P21 round 2 performance finding 4(b): keyed by the same key as conns — a dial in progress
	// for a not-yet-open database, so a second concurrent get() for it waits on this dial's own
	// outcome instead of starting a duplicate one. This used to be documented as "a faithful port
	// of an existing, accepted behaviour" (client.ts has the identical race under JS's
	// single-threaded await interleaving), but adapterhost dispatches concurrently by design here
	// — not just interleaved — so two Reads opening the same cold database really do race, and the
	// loser's own *pgx.Conn (and the real Postgres backend process behind it) used to leak
	// silently, living until the app exits.
	dialing map[string]*dialInFlight
}

// dialInFlight is one in-progress get() dial for a key — done closes once the attempt finishes,
// success or failure. A waiter never reads this dial's own outcome directly: it simply re-runs
// get()'s own loop once done closes, which re-checks s.conns (present if this dial succeeded) and
// otherwise falls through to dialing the key itself (if it failed, or if this dial was for a
// different generation of the same key — see get()'s own comment). That keeps a failed dial's
// error from needing to be threaded through every waiter; each one gets an equal chance to retry.
type dialInFlight struct {
	done chan struct{}
}

// NewConnSet constructs a ConnSet for cfg.
func NewConnSet(cfg model.ResolvedConnectionConfig, log func(level, message string)) *ConnSet {
	return &ConnSet{cfg: cfg, log: log, conns: make(map[string]*connEntry), dialing: make(map[string]*dialInFlight)}
}

// get returns the entry for database (empty string means the primary), opening a connection for it
// if none exists yet and evicting the least-recently-used non-primary connection first if the set is
// full.
//
// P21 round 2 performance finding 4: two independent fixes over the single-dial version.
// (a) evictLRULocked used to run — network Close(ctx) round trip and all — while s.mu was still
// held, so opening a 9th database while a long op ran on the LRU victim blocked *every* other
// database of this connection (including a bare map lookup for the already-open primary) behind
// that op's own victim.mu.Lock(). detachLRULocked below only touches the map/lru under s.mu; the
// actual close happens after s.mu is released.
// (b) the dial itself used to run with no lock held at all, so two concurrent get() calls for the
// same not-yet-open database both dialed, with the second overwriting the first in conns — a
// leaked *pgx.Conn and a leaked live Postgres backend process for the life of the app. The
// dialing map above turns this into a single-flight: the first caller for a key dials while
// holding a placeholder; everyone else waits on that placeholder's own outcome instead.
func (s *ConnSet) get(ctx context.Context, database string) (*connEntry, error) {
	key := database
	if key == "" {
		key = primaryKey
	}

	for {
		s.mu.Lock()
		if existing, ok := s.conns[key]; ok {
			s.touchLocked(key)
			s.mu.Unlock()
			return existing, nil
		}
		if inFlight, ok := s.dialing[key]; ok {
			s.mu.Unlock()
			select {
			case <-inFlight.done:
				// Re-check from the top: the dial that just finished may have been this key's
				// (conns now has it, or it failed and this caller should try dialing itself) or
				// — in principle — a still-different one if keys were reused mid-wait, which
				// cannot happen here since a key is only ever removed from dialing once, by its
				// own dialer.
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		// This goroutine is now the one dialing key — every concurrent caller for the same key
		// takes the branch above instead, until waiter.done closes.
		waiter := &dialInFlight{done: make(chan struct{})}
		s.dialing[key] = waiter
		var victim *connEntry
		// Counting in-flight dials against maxConns too (not just s.conns) closes the "related,
		// minor" gap the same finding names: without it, N concurrent first-time opens could
		// previously all pass this check before any of them finished dialing, transiently
		// exceeding maxConns.
		if len(s.conns)+len(s.dialing) > maxConns {
			victim = s.detachLRULocked()
		}
		s.mu.Unlock()

		if victim != nil {
			victim.mu.Lock()
			_ = victim.conn.Close(ctx)
			victim.mu.Unlock()
		}

		entry, err := s.dial(ctx, database)

		s.mu.Lock()
		delete(s.dialing, key)
		if err == nil {
			s.conns[key] = entry
			s.touchLocked(key)
		}
		s.mu.Unlock()

		close(waiter.done)
		return entry, err
	}
}

// pgxConnect — pgx.ConnectConfig, the exact function dial calls — is a package-level var (the
// same seam-by-var shape httpclient/wire.go's own wireProxyFunc and bridge/grpc.go's own
// serverStreamFn already establish) so a test can substitute a fake with a controlled delay and
// outcome, with no real network dial needed, to observe get()'s own single-flight behavior under
// genuine goroutine concurrency.
var pgxConnect = pgx.ConnectConfig

// dial is get()'s own single-attempt dial, split out so get() can call it with no lock held —
// pgx.ConnectConfig is a real network round trip, and the whole point of the dialing placeholder
// above is that nothing here needs s.mu at all.
func (s *ConnSet) dial(ctx context.Context, database string) (*connEntry, error) {
	connConfig, err := buildConfig(s.cfg, database, s.log)
	if err != nil {
		return nil, mapError(err)
	}
	conn, err := pgxConnect(ctx, connConfig)
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

	return &connEntry{conn: conn}, nil
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

// detachLRULocked picks the least-recently-used non-primary connection to make room — a user
// expanding twenty databases should not open twenty backends — removes it from the map/lru under
// s.mu (the only part of eviction that needs the global lock), and returns it for the caller to
// close *after* releasing s.mu. A no-op (nil) if every open connection is the primary (never
// evicted).
//
// P21 round 2 performance finding 4(a): this used to close the victim (victim.mu.Lock() — held for
// the victim's entire in-flight op, per connEntry's own doc comment — plus a real network
// Close(ctx) round trip) while s.mu was still held by get()'s own caller. That meant opening a 9th
// database while a long query ran on the LRU victim blocked get()/Acquire() for *every* database
// of this connection, including a bare map lookup for an already-open, completely unrelated
// primary, until the long query finished. Splitting detach (map-only, fast, needs s.mu) from close
// (can block on the network and on the victim's own lock, needs no lock at all once detached) is
// the fix — get() now calls this and does the actual Close after unlocking s.mu.
func (s *ConnSet) detachLRULocked() *connEntry {
	var victimKey string
	for _, k := range s.lru {
		if k != primaryKey {
			victimKey = k
			break
		}
	}
	if victimKey == "" {
		return nil
	}
	victim := s.conns[victimKey]
	delete(s.conns, victimKey)
	for i, k := range s.lru {
		if k == victimKey {
			s.lru = append(s.lru[:i], s.lru[i+1:]...)
			break
		}
	}
	return victim
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
