package redis

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// P2 R2: resolveFields used to fold require/prefer/verify-full into one bool and always build
// InsecureSkipVerify:true, so a connection configured for the strictest mode (verify-full) got
// the same no-verification TLS as require/prefer — silently vulnerable to a MITM presenting any
// certificate while the UI reported the strictest mode. postgres/mysqlfamily/mongo all already
// distinguish verify-full (real verification) from require/prefer (skip verification); this
// guards redis actually doing the same now that resolveFields returns a real *tls.Config.
func TestResolveFields_TLSModes(t *testing.T) {
	host := "redis.example.com"
	cfg := func(sslmode string) model.ResolvedConnectionConfig {
		return model.ResolvedConnectionConfig{
			Host:    &host,
			Options: map[string]any{"sslmode": sslmode},
		}
	}

	t.Run("disable leaves tlsConfig nil", func(t *testing.T) {
		fields, _, err := resolveFields(cfg("disable"), nil)
		if err != nil {
			t.Fatalf("resolveFields: %v", err)
		}
		if fields.tlsConfig != nil {
			t.Fatalf("tlsConfig = %+v, want nil for sslmode=disable", fields.tlsConfig)
		}
	})

	for _, mode := range []string{"require", "prefer"} {
		t.Run(mode+" skips certificate verification", func(t *testing.T) {
			fields, _, err := resolveFields(cfg(mode), nil)
			if err != nil {
				t.Fatalf("resolveFields: %v", err)
			}
			if fields.tlsConfig == nil || !fields.tlsConfig.InsecureSkipVerify {
				t.Fatalf("tlsConfig = %+v, want InsecureSkipVerify:true for sslmode=%s", fields.tlsConfig, mode)
			}
		})
	}

	t.Run("verify-full actually verifies the certificate", func(t *testing.T) {
		fields, _, err := resolveFields(cfg("verify-full"), nil)
		if err != nil {
			t.Fatalf("resolveFields: %v", err)
		}
		if fields.tlsConfig == nil {
			t.Fatal("tlsConfig is nil, want a verifying *tls.Config for sslmode=verify-full")
		}
		if fields.tlsConfig.InsecureSkipVerify {
			t.Fatal("InsecureSkipVerify = true for sslmode=verify-full — certificate verification is disabled")
		}
		if fields.tlsConfig.ServerName != host {
			t.Fatalf("ServerName = %q, want %q", fields.tlsConfig.ServerName, host)
		}
	})
}

// P12 round 2 finding #2: every other URI-parsing adapter (clickhouse, mysqlfamily, sqlite, kafka)
// returns a connect error when url.Parse fails; resolveFields used to silently fall through with
// every field left at its zero value, which host/port then defaulted to localhost:6379 with no
// password — a malformed URI silently connected to whatever Redis is running on the user's own
// machine, unauthenticated, instead of surfacing the parse failure.
func TestResolveFields_UnparsableURIIsConnectError(t *testing.T) {
	for _, uri := range []string{
		"redis://host:port/0",  // non-numeric port
		"redis://ho st:6379/0", // unescaped space in host
		"redis://a:b:c/0",      // unbracketed multi-colon host, e.g. an IPv6 literal
	} {
		t.Run(uri, func(t *testing.T) {
			cfg := model.ResolvedConnectionConfig{Mode: "uri", URI: &uri}
			if _, _, err := resolveFields(cfg, nil); err == nil {
				t.Fatalf("resolveFields(%q) err = nil, want a connect error", uri)
			}
		})
	}
}
