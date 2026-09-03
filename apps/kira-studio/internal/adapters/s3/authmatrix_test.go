// authmatrix_test.go is the complete (Tier 2) suite's own table for s3 — P25 §2.8. Rows 1-6 mirror
// sqs's own table (both share awscfg); rows 7-9 are s3-only, exercising options.bucket (§1.5d's
// previously-untested least-privilege-IAM path).
package s3_test

import (
	"context"
	"os"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// clearAwsEnv mirrors sqs/authmatrix_test.go's own — this sandbox's outbound proxy injects
// placeholder AWS_* credentials (AGENTS.md), which would otherwise mask the "no credentials
// anywhere" case §1.5a's transcript needs.
var clearAwsEnv = &testsupport.Principal{
	Name: "clear ambient AWS env",
	Setup: func(t *testing.T, _ any) {
		t.Helper()
		for _, k := range []string{"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE"} {
			old, had := os.LookupEnv(k)
			_ = os.Unsetenv(k)
			t.Cleanup(func() {
				if had {
					_ = os.Setenv(k, old)
				}
			})
		}
	},
}

func TestS3_AuthMatrix(t *testing.T) {
	testsupport.RequireMatrix(t)
	f := testsupport.StartS3(t)

	testsupport.RunMatrix(t, "s3", f, f.Config, []testsupport.Case{
		{
			Name:   "uri mode, key+secret in the URI host",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig { return c },
			Expect: testsupport.Outcome{Succeed: true},
		},
		{
			Name: "uri mode, key only, no secret",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.URI = testsupport.Strp("s3://" + testsupport.LocalStackStaticAccessKey + "@" + testsupport.LocalStackRegion)
				return c
			},
			Expect: testsupport.Outcome{Succeed: true},
		},
		{
			Name: "uri mode, malformed URI",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.URI = testsupport.Strp("not a valid uri at all")
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeConnect},
		},
		{
			Name:      "fields mode, region only, no profile, no ambient credentials",
			Principal: clearAwsEnv,
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Mode = "fields"
				c.Database = testsupport.Strp(testsupport.LocalStackRegion)
				c.Username, c.URI, c.Options = nil, nil, map[string]any{}
				return c
			},
			Expect: testsupport.Outcome{NotCode: adapters.CodeAuth},
		},
		{
			Name: "fields mode, profile that does not exist",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Mode = "fields"
				c.Database = testsupport.Strp(testsupport.LocalStackRegion)
				c.Username = testsupport.Strp("p25-nonexistent-profile")
				c.URI, c.Options = nil, map[string]any{}
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeAuth},
		},
		{
			// Every functional s3 test today runs URI mode (testsupport/s3.go's own config is
			// URI-only). Fields mode otherwise reaches Connect and stops — awscfg's fields branch
			// (Resolve, fields-mode arm) had never served a data-plane request before this. Relies on
			// the sandbox's own ambient placeholder AWS_* env (AGENTS.md), which LocalStack accepts
			// unconditionally (P25 §2.3, measured) — no clearAwsEnv Principal here.
			Name: "fields mode, region set, ambient credentials",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Mode = "fields"
				c.Database = testsupport.Strp(testsupport.LocalStackRegion)
				c.Username, c.URI = nil, nil
				return c
			},
			Expect: testsupport.Outcome{Succeed: true},
			Then: []testsupport.Scenario{
				testsupport.ReadFirstPage(testsupport.NodePath(f.Config.ID, testsupport.Seg("bucket", testsupport.S3MainBucket), testsupport.Seg("object", testsupport.S3RootObjectKey))),
			},
		},
		{
			Name: "fields mode, region unset",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Mode = "fields"
				c.Database, c.Username, c.URI = nil, nil, nil
				c.Options = map[string]any{}
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeConnect},
		},
		{
			Name: "options.bucket scoped to main-bucket",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Options = mergeOptions(c.Options, "bucket", testsupport.S3MainBucket)
				return c
			},
			Expect: testsupport.Outcome{Succeed: true},
			Then: []testsupport.Scenario{
				{
					Name: "Children(root) is [main-bucket]",
					Run: func(t *testing.T, a adapters.Adapter, cfg model.ResolvedConnectionConfig) {
						children, err := a.Children(context.Background(), testsupport.NodePath(cfg.ID), adapters.NewOpCtx("matrix-children"))
						if err != nil {
							t.Fatalf("Children: %v", err)
						}
						names := testsupport.ChildNames(t, children)
						if len(names) != 1 || names[0] != testsupport.S3MainBucket {
							t.Errorf("names = %v, want exactly [%s]", names, testsupport.S3MainBucket)
						}
					},
				},
				// P25 §1.5d: this is the code path written specifically for a single-bucket IAM
				// policy — the least-privilege shape — and P25 asserted only Children(root) on it.
				// Its Read, Count and download were untested under the scoped posture until now.
				testsupport.ReadFirstPage(testsupport.NodePath(f.Config.ID, testsupport.Seg("bucket", testsupport.S3MainBucket), testsupport.Seg("object", testsupport.S3NestedObjectKey))),
				testsupport.CountMatchesRead(testsupport.NodePath(f.Config.ID, testsupport.Seg("bucket", testsupport.S3MainBucket), testsupport.Seg("object", testsupport.S3RootObjectKey))),
				testsupport.DownloadRoundTrips(testsupport.NodePath(f.Config.ID, testsupport.Seg("bucket", testsupport.S3MainBucket), testsupport.Seg("object", testsupport.S3NestedObjectKey))),
			},
		},
		{
			Name: "options.bucket naming a bucket that does not exist",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig {
				c.Options = mergeOptions(c.Options, "bucket", "p25-nonexistent-bucket")
				return c
			},
			Expect: testsupport.Outcome{FailWith: adapters.CodeQuery},
		},
		{
			Name:   "options.bucket unset",
			Config: func(c model.ResolvedConnectionConfig) model.ResolvedConnectionConfig { return c },
			Expect: testsupport.Outcome{Succeed: true},
			Then: []testsupport.Scenario{
				{
					Name: "Children(root) includes every seeded bucket",
					Run: func(t *testing.T, a adapters.Adapter, cfg model.ResolvedConnectionConfig) {
						children, err := a.Children(context.Background(), testsupport.NodePath(cfg.ID), adapters.NewOpCtx("matrix-children"))
						if err != nil {
							t.Fatalf("Children: %v", err)
						}
						names := testsupport.ChildNames(t, children)
						for _, want := range []string{testsupport.S3MainBucket, testsupport.S3EmptyBucket, testsupport.S3MutableBucket} {
							if !testsupport.ContainsName(names, want) {
								t.Errorf("names = %v, want to contain %q", names, want)
							}
						}
					},
				},
			},
		},
	})

	// §2.8 row 7, declined — see sqs/authmatrix_test.go's own identical row for the reasoning.
	t.Run("uri mode, valid credentials, options.endpoint absent (declined: needs real AWS network access)", func(t *testing.T) {
		testsupport.RequireMatrix(t)
		t.Skip("declined: reaching real AWS with no endpoint override depends on outbound network this sandbox does not have")
	})
}

func mergeOptions(base map[string]any, key string, value any) map[string]any {
	out := make(map[string]any, len(base)+1)
	for k, v := range base {
		out[k] = v
	}
	out[key] = value
	return out
}
