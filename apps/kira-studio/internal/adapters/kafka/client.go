package kafka

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/url"
	"strconv"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

const connectTimeout = 10 * time.Second // client.ts's CONNECT_TIMEOUT_MS

// connect is client.ts's connectKafka (P58e E15/E16). Resolves host/port/credentials from URI or
// fields mode, then kgo.NewClient (no I/O yet) -> Client.Ping (a bounded reachability probe,
// franz-go's own analogue of client.ts's admin.listTopics({timeout}) probe — "admin.connect()
// alone proves nothing about broker reachability") -> kadm.NewClient. opts is returned alongside
// so read.go can build the ephemeral per-browse client from the same seed/security options
// (P58e E5) without duplicating the resolution logic.
func connect(ctx context.Context, cfg model.ResolvedConnectionConfig, log func(level, message string)) (*kgo.Client, *kadm.Client, []kgo.Opt, error) {
	var host string
	var port int
	var username, password string

	if cfg.Mode == "uri" && cfg.URI != nil && *cfg.URI != "" {
		// url.Parse is permissive where client.ts's `new URL` throws (a malformed string still
		// "parses" with an empty Host) — the emptiness check below, not a parse error, is what
		// carries the "could not parse the connection URI" case (mirrors awscfg.Resolve's own
		// documented asymmetry).
		u, err := url.Parse(*cfg.URI)
		if err != nil || u.Hostname() == "" {
			return nil, nil, nil, mapError(errors.New("could not parse the connection URI"))
		}
		host = u.Hostname()
		port = 9092
		if p := u.Port(); p != "" {
			if n, err := strconv.Atoi(p); err == nil {
				port = n
			}
		}
		if u.User != nil {
			username = u.User.Username()
			password, _ = u.User.Password()
		}
	} else {
		host = "localhost"
		if cfg.Host != nil && *cfg.Host != "" {
			host = *cfg.Host
		}
		port = 9092
		if cfg.Port != nil {
			port = *cfg.Port
		}
		if cfg.Username != nil {
			username = *cfg.Username
		}
		if cfg.Password != nil {
			password = *cfg.Password
		}
	}

	// The sslmode handling ports byte-identically (P58e E16): every non-'disable' mode
	// (require/prefer/verify-full) verifies — deliberately unlike libpq's own `require` (no
	// verification), and a driver swap is the wrong commit to smuggle a security-relevant
	// behaviour change into.
	ssl := false
	if sslmode, ok := cfg.Options["sslmode"].(string); ok && sslmode != "" && sslmode != "disable" {
		switch sslmode {
		case "require", "prefer", "verify-full":
			ssl = true
		default:
			// An unrecognized sslmode must fail loudly rather than silently fall back to a
			// plaintext connection — a typo here would otherwise send credentials and data
			// unencrypted while the user believes TLS is configured.
			return nil, nil, nil, adapters.New(adapters.CodeConnect, `kafka: unknown sslmode "`+sslmode+`"`, nil)
		}
	}

	opts := []kgo.Opt{
		kgo.SeedBrokers(net.JoinHostPort(host, strconv.Itoa(port))),
		kgo.ClientID("kira-studio"),
		kgo.DialTimeout(connectTimeout),
		// P58e E14: franz-go's idempotent producing defaults on where librdkafka's defaults off.
		// Idempotency needs an InitProducerId round trip, which hangs rather than failing on a
		// single-broker cluster whose transaction.state.log.replication.factor is Kafka's default
		// of 3 (packages/db-fixtures/support/kafka.ts's own scar). Matching librdkafka's default is the
		// conservative, behaviour-preserving choice — kept regardless of what a test container
		// (which sets the replication factor to 1) would show (KF-4(e)).
		kgo.DisableIdempotentWrite(),
	}
	if ssl {
		opts = append(opts, kgo.DialTLSConfig(&tls.Config{}))
	}
	// P25 §1.4: SASL/PLAIN was configured only when username *and* password were both non-empty —
	// with only one of the pair present, the whole mechanism was silently dropped and the client
	// connected anonymously; against a SASL-requiring broker that surfaced as a transport-level
	// refusal (E_QUERY, "is SASL missing?"), blaming the broker for a credential this app chose not
	// to send.
	//
	// Deviation from the plan's own prescribed fix, found implementing against the real driver:
	// franz-go's plain.Auth.AsMechanism() (pkg/sasl/plain/plain.go) refuses locally — before ever
	// contacting the broker — the instant either User or Pass is empty ("PLAIN user and pass must
	// be non-empty"), an error kafka/errors.go's mapError has no reason to classify as auth. The
	// plan's own fix only special-cased "password with no username"; reproduced against a real
	// SASL_PLAINTEXT broker, "username with no password" still surfaced as E_QUERY through that
	// client-side refusal, not the E_AUTH the plan's own §2.7 matrix asserts for it. Both halves of
	// a half-filled pair are equally unusable by this mechanism, so both are treated symmetrically.
	halfFilledCreds := (username == "") != (password == "")
	if username != "" && password != "" {
		opts = append(opts, kgo.SASL(plain.Auth{User: username, Pass: password}.AsMechanism()))
	}
	// A half-filled pair no longer fails up front (finding 6): ConnectionDialog.vue pairs
	// username/password on one row, so a PLAINTEXT broker with a stray, half-typed credential must
	// still connect anonymously, ignoring it, exactly as it did before P25 §1.4 — dial without SASL
	// (the branch above skips it for a half-filled pair, same as an empty pair) and let the dial
	// itself decide.
	if halfFilledCreds {
		// round-2 finding 6: against a PLAINTEXT broker this silently drops the half-typed
		// credential with no trace — log it, matching the redis adapter's own INFO-refused
		// precedent (internal/adapters/redis/adapter.go).
		log("warn", "kafka: half-filled username/password ignored (both are required for SASL/PLAIN)")
	}

	cl, err := kgo.NewClient(opts...)
	if err != nil {
		return nil, nil, nil, mapError(err)
	}
	if err := cl.Ping(ctx); err != nil {
		cl.Close()
		// Only when the anonymous dial fails the specific way a SASL-requiring broker's own
		// missing-credential refusal does — franz-go's own *kgo.ErrFirstReadEOF, its "is SASL
		// missing?" diagnosis (confirmed against a real SASL_PLAINTEXT broker: an anonymous dial
		// here fails with exactly this) — is the half-filled pair actually likely the reason,
		// so surface the plan's own clear E_AUTH instead of the raw, confusing broker-side text.
		// A fully-omitted pair does not get this treatment (§1.3/the matrix's own "neither set"
		// case): nothing was offered there, so blaming a credential the caller never attempted
		// would be wrong; here, one half of a pair was actually typed in.
		//
		// round-2 finding 5: ErrFirstReadEOF is constructed at three different call sites inside
		// franz-go with no way to tell them apart from here, so it can't actually distinguish a
		// SASL-requiring broker from a TLS misconfiguration or a connection severed for some other
		// reason — the message below names multiple possibilities rather than asserting SASL
		// specifically, even though SASL is the scenario this heuristic is scoped to detect.
		if halfFilledCreds {
			var firstReadEOF *kgo.ErrFirstReadEOF
			if errors.As(err, &firstReadEOF) {
				return nil, nil, nil, adapters.New(adapters.CodeAuth,
					"kafka: connection closed immediately after a half-filled username/password — "+
						"the broker may require SASL/PLAIN authentication (needs both a username and "+
						"a password), TLS, or the connection was otherwise refused", nil)
			}
		}
		return nil, nil, nil, mapError(err)
	}
	return cl, kadm.NewClient(cl), opts, nil
}
