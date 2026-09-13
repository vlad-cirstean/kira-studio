package grpcclient

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

// Target is D6's normalised dial target and the TLS decision that goes with it.
type Target struct {
	// Dial is what actually gets passed to grpc.NewClient — a bare host:port, or a resolver-scheme
	// target (dns:///, unix://, unix-abstract://, passthrough://) passed through untouched (F12:
	// both tested resolver schemes dial correctly).
	Dial string
	// TLS is the effective decision after a recognised *web* scheme (if any) has overridden the
	// caller's own toggle — a scheme is not part of a gRPC address (F12), but a URL-shaped target
	// is the single most likely thing anyone arriving from the HTTP tab next door types (P2 D4's
	// own "a URL with no scheme resolves to https://" teaches exactly that habit).
	TLS bool
}

// grpcResolverSchemes are real gRPC resolver schemes (F12: both tested ones dial correctly) —
// passed through untouched, never treated as a web scheme to strip.
var grpcResolverSchemes = []string{"dns://", "unix://", "unix-abstract://", "passthrough://"}

// webSchemes: prefix -> the TLS decision it implies. Longest/most-specific first is not needed
// since these are mutually exclusive prefixes.
var webSchemes = map[string]bool{
	"https://": true,
	"grpcs://": true,
	"http://":  false,
	"grpc://":  false,
}

// NormalizeTarget is D6, verbatim against F12's nine measured strings plus the no-port case.
// tlsRequested is the caller's own TLS toggle; a recognised web scheme in raw overrides it.
func NormalizeTarget(raw string, tlsRequested bool) (Target, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return Target{}, BadRequest("a target is required")
	}

	for _, scheme := range grpcResolverSchemes {
		if strings.HasPrefix(trimmed, scheme) {
			// F12: a real resolver scheme is not a host:port at all — passed through untouched,
			// with no path/port validation, which would misfire against e.g. unix:///tmp/a.sock.
			return Target{Dial: trimmed, TLS: tlsRequested}, nil
		}
	}

	rest := trimmed
	tls := tlsRequested
	for scheme, impliesTLS := range webSchemes {
		if strings.HasPrefix(trimmed, scheme) {
			rest, tls = trimmed[len(scheme):], impliesTLS
			break
		}
	}

	if i := strings.IndexAny(rest, "/?#"); i != -1 {
		return Target{}, BadRequest(fmt.Sprintf(
			"a gRPC target is a host and port, not a URL — remove %q", rest[i:]))
	}
	if rest == "" {
		return Target{}, BadRequest("a target is required")
	}

	if !strings.Contains(rest, ":") {
		if tls {
			rest += ":443"
		} else {
			return Target{}, BadRequest("a plaintext target needs an explicit port")
		}
	}

	return Target{Dial: rest, TLS: tls}, nil
}

// dialConn builds one *grpc.ClientConn for one call (D7, F16: grpc.NewClient is lazy — dialling
// happens on the first RPC, so building one per call costs microseconds plus the connection the
// call needs anyway). InsecureSkipVerify is never offered (§0.2/D6): TLS verification is always on
// when TLS is enabled, with only a plaintext toggle and an optional CA-certificate file to cover
// the two real cases.
func dialConn(target string, tlsCfg TLSConfig) (*grpc.ClientConn, error) {
	norm, err := NormalizeTarget(target, tlsCfg.Enabled)
	if err != nil {
		return nil, err
	}

	var creds credentials.TransportCredentials
	if norm.TLS {
		conf := &tls.Config{ServerName: tlsCfg.ServerName}
		if tlsCfg.CAFile != "" {
			pem, err := os.ReadFile(tlsCfg.CAFile)
			if err != nil {
				return nil, BadRequest("could not read CA file: " + err.Error())
			}
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(pem) {
				return nil, BadRequest(tlsCfg.CAFile + " does not contain a valid PEM certificate")
			}
			conf.RootCAs = pool
		}
		creds = credentials.NewTLS(conf)
	} else {
		creds = insecure.NewCredentials()
	}

	conn, err := grpc.NewClient(norm.Dial, grpc.WithTransportCredentials(creds))
	if err != nil {
		return nil, Transport(err.Error())
	}
	return conn, nil
}

// metadataKeyPattern is gRPC's own legal metadata-key alphabet (F6) — validated proactively so a
// typo reads as D17's own sentence rather than grpc-go's opaque "header key … contains illegal
// characters" (still reachable, but only for a key this check somehow missed).
var metadataKeyPattern = regexp.MustCompile(`^[0-9a-z._-]+$`)

// withMetadata attaches D9's already-resolved metadata to ctx — F6: keys are lowercased, and an
// illegal key is refused here as E_GRPC_BAD_REQUEST with D17's own sentence, rather than reaching
// grpc-go's own codes.Internal at send time. Shared by reflect.go's own reflection call and
// call.go's Unary/ServerStream — a reflection fetch may need the same auth (§0.3).
func withMetadata(ctx context.Context, pairs []MetaPair) (context.Context, error) {
	if len(pairs) == 0 {
		return ctx, nil
	}
	md := metadata.MD{}
	for _, p := range pairs {
		key := strings.ToLower(strings.TrimSpace(p.Name))
		if key == "" {
			continue
		}
		if !metadataKeyPattern.MatchString(key) {
			return ctx, BadRequest(fmt.Sprintf(
				"%q is not a valid metadata key — gRPC allows lowercase letters, digits, -, _ and .", p.Name))
		}
		md.Append(key, p.Value)
	}
	return metadata.NewOutgoingContext(ctx, md), nil
}

// mdToPairs projects a metadata.MD into the wire shape, sorted for determinism.
func mdToPairs(md metadata.MD) []MetaPair {
	if len(md) == 0 {
		return nil
	}
	keys := make([]string, 0, len(md))
	for k := range md {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]MetaPair, 0, len(md))
	for _, k := range keys {
		for _, v := range md[k] {
			out = append(out, MetaPair{Name: k, Value: v})
		}
	}
	return out
}
