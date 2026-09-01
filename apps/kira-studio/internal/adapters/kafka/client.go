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
	if username != "" && password != "" {
		opts = append(opts, kgo.SASL(plain.Auth{User: username, Pass: password}.AsMechanism()))
	}

	cl, err := kgo.NewClient(opts...)
	if err != nil {
		return nil, nil, nil, mapError(err)
	}
	if err := cl.Ping(ctx); err != nil {
		cl.Close()
		return nil, nil, nil, mapError(err)
	}
	return cl, kadm.NewClient(cl), opts, nil
}
