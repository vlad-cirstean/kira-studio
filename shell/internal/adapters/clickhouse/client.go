package clickhouse

import (
	"net/http"
	"net/url"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// fixedSettings is client.ts's own FIXED_SETTINGS, plus one setting client.ts never had to state:
// with no persistent client-level session the way @clickhouse/client had, these travel as URL
// query parameters on every single request instead of being set once at connect time.
// Deliberately does NOT include `readonly` — query.go sends that per request instead, because it
// must apply to every data/console/mutation request but never to Cancel's own KILL QUERY (D7/D8).
//
// output_format_json_quote_64bit_integers is the one addition beyond client.ts's own list, and a
// real M6.4 finding: this server's own default for plain `FORMAT JSON` (catalog.go's/read.go's
// RunCatalogQuery, used for total_rows/count()/etc.) is to emit a UInt64/Int64 as a bare JSON
// number, not a quoted string — verified directly against clickhouse-server:26.3, not assumed —
// and every catalog struct in this package is typed `string`/`*string` for exactly such columns
// (matching @shared's own catalog.ts, which types total_rows as `string | null`). @clickhouse/
// client's own `.json()` evidently sets this itself; a hand-rolled net/http client has no such
// hidden default and must ask for it explicitly, or every UInt64/Int64-typed catalog column fails
// to unmarshal outright. JSONCompactStringsEachRowWithNamesAndTypes (the read/console/streamed
// path) is unaffected either way — every one of its own cells is already a JSON string by format
// name, never a bare number.
var fixedSettings = map[string]string{
	"default_format":                                   "JSONCompactStringsEachRowWithNamesAndTypes",
	"output_format_json_validate_utf8":                 "1",
	"show_table_uuid_in_table_create_query_if_not_nil": "0",
	"date_time_output_format":                          "simple",
	"output_format_json_quote_64bit_integers":          "1",
}

// Handle is client.ts's ClickHouseHandle — B11: a plain *http.Client, no ClickHouse driver at all.
type Handle struct {
	Client          *http.Client
	URL             string
	Username        string
	Password        string
	DefaultDatabase string
	ReadOnly        bool
}

type resolvedTarget struct {
	scheme   string
	host     string
	port     int
	database string
	username string
	password string
}

// resolveTarget is client.ts's own — D12: sslmode's only real distinction here is http vs https;
// require/verify-full both just mean "speak https", the same collapsed distinction client.ts's own
// comment already committed to for this driver.
func resolveTarget(cfg model.ResolvedConnectionConfig, log func(level, message string)) (resolvedTarget, error) {
	var host, database, username, password *string
	var port *int

	if cfg.Mode == "uri" && cfg.URI != nil && *cfg.URI != "" {
		u, err := url.Parse(*cfg.URI)
		if err != nil {
			return resolvedTarget{}, adapters.New(adapters.CodeConnect, "could not parse the connection URI", err)
		}
		h := u.Hostname()
		host = &h
		if p := u.Port(); p != "" {
			if n, perr := parsePort(p); perr == nil {
				port = &n
			}
		}
		d := u.Path
		if len(d) > 0 && d[0] == '/' {
			d = d[1:]
		}
		if d != "" {
			database = &d
		}
		if u.User != nil {
			un := u.User.Username()
			username = &un
			if pw, ok := u.User.Password(); ok {
				password = &pw
			}
		}
	} else {
		host = cfg.Host
		port = cfg.Port
		database = cfg.Database
		username = cfg.Username
		password = cfg.Password
	}
	if host == nil || *host == "" {
		return resolvedTarget{}, adapters.New(adapters.CodeConnect, "no host was given", nil)
	}

	scheme := "http"
	if sslmode, ok := cfg.Options["sslmode"].(string); ok && sslmode != "" && sslmode != "disable" {
		switch sslmode {
		case "require", "verify-full":
			scheme = "https"
		default:
			// An unrecognized sslmode must fail loudly rather than silently fall back to a
			// plaintext connection — a typo here would otherwise send credentials and data
			// unencrypted while the user believes TLS is configured.
			return resolvedTarget{}, adapters.New(adapters.CodeConnect, "clickhouse: unknown sslmode \""+sslmode+"\"", nil)
		}
	}

	target := resolvedTarget{scheme: scheme, host: *host, port: 8123, database: "default"}
	if port != nil {
		target.port = *port
	}
	if database != nil && *database != "" {
		target.database = *database
	}
	if username != nil {
		target.username = *username
	}
	if password != nil {
		target.password = *password
	}
	return target, nil
}

func parsePort(s string) (int, error) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, adapters.New(adapters.CodeConnect, "invalid port", nil)
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}

const httpClientTimeout = 60 * time.Second

// OpenClient is client.ts's openClient — B11/B7: MaxIdleConnsPerHost is at least 2 so Cancel's own
// KILL QUERY request always has a free connection in the pool (caps.ts's own F7/F9 note: "a second
// HTTP request the client's own connection pool already has free").
func OpenClient(cfg model.ResolvedConnectionConfig, log func(level, message string)) (*Handle, error) {
	target, err := resolveTarget(cfg, log)
	if err != nil {
		return nil, err
	}
	transport := &http.Transport{MaxIdleConnsPerHost: 4}
	client := &http.Client{Transport: transport, Timeout: httpClientTimeout}
	u := target.scheme + "://" + target.host + ":" + itoaPositive(target.port)
	return &Handle{
		Client: client, URL: u, Username: target.username, Password: target.password,
		DefaultDatabase: target.database, ReadOnly: cfg.ReadOnly,
	}, nil
}

func itoaPositive(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
