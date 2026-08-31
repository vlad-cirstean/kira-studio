// Package awscfg is the whole of what sqs and s3 share (P58d D2) — client-config resolution and
// error mapping, roughly 70 lines. Not a mysqlfamily-style shared core: the two TypeScript
// packages share only client.ts's shape and errors.ts's table, nothing else.
package awscfg

import (
	"context"
	"net/url"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// Resolved is what both adapters need from a ResolvedConnectionConfig before constructing their
// own SDK client.
type Resolved struct {
	AWS          aws.Config
	BaseEndpoint string // "" when the connection has no options.endpoint override
}

// Resolve reproduces sqs/client.ts's and s3/client.ts's shared connectX logic exactly, for both
// modes (P58d D7). kindLabel is the adapter's own kind ("sqs" | "s3"), used only for the endpoint-
// override log line's prefix, matching each TypeScript file's own `log('info', '<kind>: overriding
// endpoint to <endpoint>')`.
func Resolve(ctx context.Context, cfg model.ResolvedConnectionConfig, kindLabel string, log func(level, message string)) (Resolved, error) {
	var region string
	var opts []func(*awsconfig.LoadOptions) error

	if cfg.Mode == "uri" && cfg.URI != nil {
		// url.Parse is permissive where the TypeScript's `new URL` throws (a malformed string
		// still "parses" with an empty Host) — the emptiness check below, not a parse error, is
		// what carries the "could not parse" case, mirroring sqlite/client.go's own documented
		// asymmetry for the same Go/JS gap.
		u, err := url.Parse(*cfg.URI)
		if err != nil || u.Hostname() == "" {
			return Resolved{}, mapPlainError("could not parse the connection URI")
		}
		region = u.Hostname()
		if u.User != nil {
			password, hasPassword := u.User.Password()
			if u.User.Username() != "" && hasPassword {
				opts = append(opts, awsconfig.WithCredentialsProvider(
					credentials.NewStaticCredentialsProvider(u.User.Username(), password, ""),
				))
			}
		}
	} else {
		if cfg.Database == nil || *cfg.Database == "" {
			return Resolved{}, mapPlainError(`a region is required (the "database" field)`)
		}
		region = *cfg.Database
		if cfg.Username != nil && *cfg.Username != "" {
			opts = append(opts, awsconfig.WithSharedConfigProfile(*cfg.Username))
		}
	}
	opts = append(opts, awsconfig.WithRegion(region))

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return Resolved{}, mapPlainError(err.Error())
	}

	baseEndpoint := ""
	if raw, ok := cfg.Options["endpoint"]; ok {
		if s, ok := raw.(string); ok && s != "" {
			baseEndpoint = s
			log("info", kindLabel+": overriding endpoint to "+s)
		}
	}

	return Resolved{AWS: awsCfg, BaseEndpoint: baseEndpoint}, nil
}

func mapPlainError(message string) *adapters.Error {
	return adapters.New(adapters.CodeQuery, message, nil)
}
