// authmatrix_test.go is the complete (Tier 2) suite's own table for kafka — P25 §2.7. Kafka has
// no "database" analogue at all; its axes are mechanism, credentials and broker address. Two
// fixtures: the existing PLAINTEXT broker and the SASL_PLAINTEXT/PLAIN one testsupport.go adds for
// this phase.
package kafka_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func TestKafka_AuthMatrix(t *testing.T) {
	testsupport.RequireMatrix(t)
	plaintext := testsupport.StartKafka(t)
	sasl := testsupport.StartKafkaSasl(t)

	testsupport.RunMatrix(t, "kafka", plaintext, plaintext.Config, []testsupport.Case{
		{
			Name:   "PLAINTEXT broker, no credentials",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig { return c },
			Expect: testsupport.Outcome{Succeed: true},
		},
		{
			// Deviation from the plan's own row: it expects this to connect. Reproduced against a
			// real PLAINTEXT-only broker: it does not — the broker replies
			// "ILLEGAL_SASL_STATE: Request is not valid given the current SASL state", a
			// protocol-level refusal with no kerr.Error case of its own in kafka/errors.go, so it
			// falls through to the default E_QUERY. Still worth pinning, just as a failure rather
			// than a success — asserting only that it is not silently successful and not
			// misclassified as an auth failure (nothing was authenticated; the broker refused the
			// handshake shape itself).
			Name: "PLAINTEXT broker, username and password both set",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Username, c.Password = testsupport.Strp("kira"), testsupport.Strp("kira")
				return c
			},
			Expect: testsupport.Outcome{NotCode: adapters.CodeAuth},
		},
		{
			Name: "PLAINTEXT broker, options.sslmode garbage",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Options = map[string]any{"sslmode": "garbage"}
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeConnect},
		},
		{
			Name: "unreachable host:port",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Host, c.Port = testsupport.Strp("127.0.0.1"), intp(1)
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeConnect},
		},
	})

	testsupport.RunMatrix(t, "kafka", sasl, sasl.Config, []testsupport.Case{
		{
			Name: "SASL broker, kira/kira",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Username, c.Password = testsupport.Strp("kira"), testsupport.Strp("kira")
				return c
			},
			Expect: testsupport.Outcome{Succeed: true, Details: map[string]string{"brokers": "1"}},
		},
		{
			Name: "SASL broker, kira/wrong",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Username, c.Password = testsupport.Strp("kira"), testsupport.Strp("wrong")
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeAuth},
		},
		{
			Name: "SASL broker, kira/empty string",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				empty := ""
				c.Username, c.Password = testsupport.Strp("kira"), &empty
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeAuth},
		},
		{
			Name: "SASL broker, kira/nil",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Username, c.Password = testsupport.Strp("kira"), nil
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeAuth},
		},
		{
			Name: "SASL broker, nil username, password set",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Username, c.Password = nil, testsupport.Strp("kira")
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeAuth},
		},
		{
			Name: "SASL broker, neither set",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Username, c.Password = nil, nil
				return c
			},
			// Nothing was offered, so the broker's own transport-level refusal stays E_QUERY —
			// correct, not a regression: assert only that it fails and is not silently successful.
			Expect: testsupport.Outcome{NotCode: adapters.CodeAuth},
		},
	})
}

func intp(n int) *int { return &n }
