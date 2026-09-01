package redis

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
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
