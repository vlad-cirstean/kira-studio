package mongo

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/url"
	"strings"
	"time"

	mongodriver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

const connectTimeout = 10 * time.Second // client.ts's own CONNECT_TIMEOUT_MS

// ClientHandle is client.ts's MongoClientHandle.
type ClientHandle struct {
	Client *mongodriver.Client
	// DefaultDatabase is the database named by the connection's own config, if any — the
	// console's fallback target.
	DefaultDatabase *string
}

// Connect is client.ts's connectMongo. D8: one pooled *mongo.Client per adapter instance — the
// driver's own internal pool handles concurrency, so there is no ConnSet/LRU analog to MariaDB's.
func Connect(ctx context.Context, cfg model.ResolvedConnectionConfig, log func(level, message string)) (*ClientHandle, error) {
	// The connection dialog's own uri builder already spells the mongodb scheme literally for
	// kind === "mongodb", and the config's own URI is re-injected with its secret before this
	// ever runs — the URI is driver-ready as-is (client.ts:22-24).
	uri := ""
	if cfg.Mode == "uri" && cfg.URI != nil && *cfg.URI != "" {
		uri = *cfg.URI
	} else {
		uri = buildURIFromFields(cfg)
	}

	clientOpts := options.Client().
		ApplyURI(uri).
		SetConnectTimeout(connectTimeout).
		SetServerSelectionTimeout(connectTimeout).
		SetDriverInfo(&options.DriverInfo{Name: "kira-studio"})

	if sslmode, ok := cfg.Options["sslmode"].(string); ok && sslmode != "" && sslmode != "disable" {
		tlsConfig, err := tlsConfigForSslmode(sslmode)
		if err != nil {
			return nil, err
		}
		clientOpts.SetTLSConfig(tlsConfig)
	}

	// mongo.Connect (v2) is lazy — it validates and parses options but opens no socket. The real
	// connectivity check is adapter.go's own admin().buildInfo() probe immediately after this
	// returns (mirroring client.ts's structure, where a v1 driver's blocking client.connect()
	// call and the TS adapter's own buildInfo() probe were two separate steps too).
	client, err := mongodriver.Connect(clientOpts)
	if err != nil {
		return nil, mapError(err)
	}

	var defaultDatabase *string
	if cfg.Mode == "uri" && cfg.URI != nil && *cfg.URI != "" {
		defaultDatabase = databaseFromURI(*cfg.URI)
	} else {
		defaultDatabase = cfg.Database
	}

	return &ClientHandle{Client: client, DefaultDatabase: defaultDatabase}, nil
}

// tlsConfigForSslmode is the pure half of the sslmode switch, split out for unit testing. Unlike
// Postgres's "require" (encrypt only, no verification — a libpq convention this app has no reason
// to inherit for MongoDB, which has no such precedent of its own), require/prefer/verify-full all
// verify here, matching the Kafka adapter's reasoning: "require" without verification accepts any
// certificate, including an attacker's, with no indication anywhere in the UI. verify-none/insecure
// is the explicit opt-out for anyone who genuinely needs the old behaviour.
func tlsConfigForSslmode(sslmode string) (*tls.Config, error) {
	switch sslmode {
	case "require", "prefer", "verify-full":
		return &tls.Config{}, nil
	case "verify-none", "insecure":
		return &tls.Config{InsecureSkipVerify: true}, nil //nolint:gosec // explicit opt-out, not the default
	default:
		// An unrecognized sslmode must fail loudly rather than silently fall back to a plaintext
		// connection — a typo here would otherwise send credentials and data unencrypted while the
		// user believes TLS is configured.
		return nil, adapters.New(adapters.CodeConnect, `mongodb: unknown sslmode "`+sslmode+`"`, nil)
	}
}

func buildURIFromFields(cfg model.ResolvedConnectionConfig) string {
	host := "localhost"
	if cfg.Host != nil && *cfg.Host != "" {
		host = *cfg.Host
	}
	port := 27017
	if cfg.Port != nil {
		port = *cfg.Port
	}
	auth := ""
	if cfg.Username != nil && *cfg.Username != "" {
		auth = url.QueryEscape(*cfg.Username)
		if cfg.Password != nil && *cfg.Password != "" {
			auth += ":" + url.QueryEscape(*cfg.Password)
		}
		auth += "@"
	}
	db := "/"
	if cfg.Database != nil && *cfg.Database != "" {
		db = "/" + url.QueryEscape(*cfg.Database)
	}
	// P25 §1.2: the URI path is MongoDB's own *defaultauthdb* — it sets authSource as well as the
	// default database. A user created in `admin` with roles on the application database (the most
	// common real posture) therefore cannot authenticate in fields mode at all, and fails with a
	// bare "Authentication failed" that names nothing the user could act on. authSource has to be
	// separately expressible; URI mode already supports it via its own query string, fields mode
	// did not.
	if src, ok := cfg.Options["authSource"].(string); ok && src != "" {
		db += "?authSource=" + url.QueryEscape(src)
	}
	return fmt.Sprintf("mongodb://%s%s:%d%s", auth, host, port, db)
}

// databaseFromURI is the one field of uri.ts's parseConnectionUri this package needs.
func databaseFromURI(uri string) *string {
	u, err := url.Parse(uri)
	if err != nil {
		return nil
	}
	db := strings.TrimPrefix(u.Path, "/")
	if db == "" {
		return nil
	}
	return &db
}
