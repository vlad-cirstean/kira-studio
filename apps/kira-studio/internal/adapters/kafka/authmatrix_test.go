// authmatrix_test.go is the complete (Tier 2) suite's own table for kafka — P25 §2.7. Kafka has
// no "database" analogue at all; its axes are mechanism, credentials and broker address. Two
// fixtures: the existing PLAINTEXT broker and the SASL_PLAINTEXT/PLAIN one testsupport.go adds for
// this phase.
package kafka_test

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
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
			Then: []testsupport.Scenario{
				{
					// P26 §3.8: no produce or consume had ever run over a SASL connection before this
					// — franz-go re-authenticates on new connections and the produce path opens its
					// own, so the connect-only assertion above never exercised it. Mirrors
					// TestKafka_Mutate_ProduceThenBrowse's own assertions, against the authenticated
					// broker instead of the PLAINTEXT one.
					Name: "produce then browse over the authenticated broker",
					Run: func(t *testing.T, a adapters.Adapter, cfg model.ResolvedConnectionConfig) {
						const topic = "p26-matrix-sasl-produce"
						testsupport.CreateTopicSasl(t, sasl, topic)
						path := testsupport.NodePath(cfg.ID, testsupport.Seg("topic", topic))

						plan := model.MutationPlan{
							Path: path,
							Ops: []model.MutationRowOp{{
								Kind: "insert",
								Values: model.RowValues{
									{Name: "$key", Value: testsupport.Strp("matrix-key")},
									{Name: "$body", Value: testsupport.Strp(`{"seq":1}`)},
									{Name: "$headers", Value: nil},
								},
							}},
						}
						result, err := a.Mutate(context.Background(), plan, adapters.NewOpCtx("matrix-sasl-produce"))
						if err != nil {
							t.Fatalf("Mutate: %v", err)
						}
						if result.AffectedRows != 1 {
							t.Fatalf("AffectedRows = %d, want 1", result.AffectedRows)
						}

						p, err := a.Read(context.Background(), adapters.ReadRequest{
							Path: path, PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
						}, adapters.NewOpCtx("matrix-sasl-browse"))
						if err != nil {
							t.Fatalf("Read: %v", err)
						}
						sp := p.(page.StreamPage)
						if sp.RowCount != 1 {
							t.Fatalf("RowCount = %d, want 1", sp.RowCount)
						}
						body := testsupport.StreamBodyAt(t, sp, 0)
						if body == nil || *body != `{"seq":1}` {
							t.Errorf("body = %v, want {\"seq\":1}", body)
						}
					},
				},
				{
					// Pins that an unknown topic stays E_QUERY rather than being swept into E_AUTH by
					// the authenticated path (errors.go:61-62 is the branch this protects).
					Name: "reading a nonexistent topic stays E_QUERY",
					Run: func(t *testing.T, a adapters.Adapter, cfg model.ResolvedConnectionConfig) {
						_, err := a.Read(context.Background(), adapters.ReadRequest{
							Path:     testsupport.NodePath(cfg.ID, testsupport.Seg("topic", "p26-matrix-no-such-topic")),
							PageSize: 10, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
						}, adapters.NewOpCtx("matrix-sasl-nonexistent"))
						if err == nil {
							t.Fatal("Read: want an error, got nil")
						}
						code, _ := adapters.CodeOf(err)
						if code != adapters.CodeQuery {
							t.Errorf("code = %v, want E_QUERY", code)
						}
					},
				},
			},
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
