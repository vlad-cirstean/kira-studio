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

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
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
		switch sslmode {
		case "require", "prefer":
			clientOpts.SetTLSConfig(&tls.Config{InsecureSkipVerify: true}) //nolint:gosec // matches client.ts's own tlsAllowInvalidCertificates
		case "verify-full":
			clientOpts.SetTLSConfig(&tls.Config{})
		default:
			// An unrecognized sslmode must fail loudly rather than silently fall back to a
			// plaintext connection — a typo here would otherwise send credentials and data
			// unencrypted while the user believes TLS is configured.
			return nil, adapters.New(adapters.CodeConnect, `mongodb: unknown sslmode "`+sslmode+`"`, nil)
		}
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
