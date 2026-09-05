package apivars

import (
	"log/slog"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpclient"
)

// ReferenceKind classifies one {{name}} reference D17's grammar found.
type ReferenceKind string

const (
	KindResolved ReferenceKind = "resolved"
	KindDeferred ReferenceKind = "deferred"
	KindDynamic  ReferenceKind = "dynamic"
	KindUnknown  ReferenceKind = "unknown"
)

// Reference is one {{name}} reference Resolve found, and how it was classified.
type Reference struct {
	Name string
	Kind ReferenceKind
}

// SubstitutionResult is Resolve's answer: the text with every resolvable reference substituted,
// and the classified list of every reference it found.
type SubstitutionResult struct {
	Text string
	Refs []Reference
}

// Resolve is the Go twin of packages/api-core/src/http/substitute.ts's own `resolve` — the identical
// two-token grammar (D17), pinned to the same behaviour by testdata/substitution.json (D18).
//
// The grammar, in full: scan for `{{`; from there scan for the next `}}`; no `}}` ⇒ the rest of
// the string is literal and the scan ends. The name is the text between, trimmed; an empty name
// is not a reference. Nesting is not a thing — `{{a{{b}}}}` takes `a{{b` as the name, finds
// nothing, and passes through literally. One pass only: a resolved value that itself contains
// `{{other}}` is never re-expanded.
func Resolve(text string, values map[string]string, secretNames []string) SubstitutionResult {
	return resolveWithSanitizer(text, values, secretNames, nil)
}

// urlUnsafeReplacer is the Go twin of packages/api-core/src/http/substitute.ts's own
// sanitizeUrlSpan (finding 6, v1.2 P14 round 2) — percent-encodes only the characters that would
// otherwise break url.Parse's RawQuery or the request line itself (a space is what actually turns
// a send into a 400; &/#/= are the query string's own structural delimiters), leaving `{{`/`}}`
// and the reference name's ordinary characters exactly as typed.
var urlUnsafeReplacer = strings.NewReplacer(
	" ", "%20", "\t", "%09", "\r", "%0D", "\n", "%0A",
	"&", "%26", "#", "%23", "=", "%3D",
)

// resolveWithSanitizer is Resolve's real body — sanitize, when non-nil, is applied to a reference
// span left literal because it will never be resolved by anyone downstream: KindUnknown (no such
// name — including a secret whose decrypt failed, since Resolver.Text always calls this with
// secretNames nil, so a still-missing secret name falls into this same branch) and KindDynamic (Go
// never generates a `{{$name}}` value itself — P6's generator is JS-only). Deliberately never
// applied to KindDeferred: a later pass elsewhere still has to find that span by its exact,
// untouched name.
func resolveWithSanitizer(text string, values map[string]string, secretNames []string, sanitize func(string) string) SubstitutionResult {
	secrets := make(map[string]bool, len(secretNames))
	for _, n := range secretNames {
		secrets[n] = true
	}
	sanitizeOrVerbatim := func(span string) string {
		if sanitize != nil {
			return sanitize(span)
		}
		return span
	}

	refs := []Reference{}
	var out strings.Builder
	i := 0
	for i < len(text) {
		open := strings.Index(text[i:], "{{")
		if open == -1 {
			out.WriteString(text[i:])
			break
		}
		open += i
		closeAt := strings.Index(text[open+2:], "}}")
		if closeAt == -1 {
			out.WriteString(text[i:])
			break
		}
		closeAt += open + 2
		out.WriteString(text[i:open])
		name := strings.TrimSpace(text[open+2 : closeAt])
		span := text[open : closeAt+2]
		i = closeAt + 2

		switch {
		case name == "":
			out.WriteString(span)
		case strings.HasPrefix(name, "$"):
			refs = append(refs, Reference{Name: name, Kind: KindDynamic})
			out.WriteString(sanitizeOrVerbatim(span))
		case secrets[name]:
			refs = append(refs, Reference{Name: name, Kind: KindDeferred})
			out.WriteString(span)
		default:
			if value, ok := values[name]; ok {
				refs = append(refs, Reference{Name: name, Kind: KindResolved})
				out.WriteString(value)
			} else {
				refs = append(refs, Reference{Name: name, Kind: KindUnknown})
				out.WriteString(sanitizeOrVerbatim(span))
			}
		}
	}
	return SubstitutionResult{Text: out.String(), Refs: refs}
}

// Names returns every distinct {{name}} reference in text, trimmed, in first-seen order — the
// same scan with no lookup and no classification. ResolveRequest uses it to decide, before ever
// querying a secret, whether a field references anything at all.
func Names(text string) []string {
	seen := map[string]bool{}
	out := []string{}
	i := 0
	for i < len(text) {
		open := strings.Index(text[i:], "{{")
		if open == -1 {
			break
		}
		open += i
		closeAt := strings.Index(text[open+2:], "}}")
		if closeAt == -1 {
			break
		}
		closeAt += open + 2
		name := strings.TrimSpace(text[open+2 : closeAt])
		i = closeAt + 2
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}

// D7's exact field list, restated here as the fields ResolveRequest walks — everything stage 1
// (the renderer) already resolved every non-secret reference in, so any reference still present
// here either names a secret or names nothing at all.
func referencedFields(url string, headers []httpclient.Header, body httpclient.Body) []string {
	fields := []string{url}
	for _, h := range headers {
		fields = append(fields, h.Name, h.Value)
	}
	switch body.Mode {
	case string(httpclient.BodyRaw):
		fields = append(fields, body.Raw)
	case string(httpclient.BodyCode):
		fields = append(fields, body.Code)
	case string(httpclient.BodyURLEncoded):
		for _, f := range body.URLEncoded {
			fields = append(fields, f.Name, f.Value)
		}
	case string(httpclient.BodyFormData):
		for _, f := range body.FormData {
			fields = append(fields, f.Name, f.ContentType)
			if f.Kind == "text" {
				fields = append(fields, f.Value)
			}
			// D7: a form-data file row's path is never substituted, so it is not walked here.
		}
	}
	return fields
}

// Resolver is P11 D9/F21's own extraction: the reusable half of stage 2 — fetch every secret
// reachable from one scope once, then substitute text and accumulate what was actually used. Two
// protocols share it now (ResolveRequest below, and bridge/grpc.go's own resolution closure via
// NewResolver), and gain no import of each other's protocol package for it: apivars gains no gRPC
// import, which is what keeps it protocol-neutral rather than becoming a two-protocol module.
type Resolver struct {
	secretValues map[string]string
	used         map[string]string
}

// NewResolver fetches every secret reachable from collectionID/environmentID once
// (repos.VariablesRepo.SecretsFor already applies D2's environment-over-collection precedence)
// and returns a resolver that substitutes text and accumulates what it actually used.
func (s *Service) NewResolver(collectionID, environmentID string) (*Resolver, error) {
	secretValues, err := s.deps.Repo.SecretsFor(collectionID, environmentID)
	if err != nil {
		return nil, err
	}
	return &Resolver{secretValues: secretValues, used: map[string]string{}}, nil
}

// Any reports whether this scope has any secret at all — false means there is nothing this
// resolver could ever substitute, so a caller can skip walking its own fields entirely.
func (r *Resolver) Any() bool {
	return len(r.secretValues) > 0
}

// Text resolves every {{name}} reference in text that names one of this scope's secrets, and
// records each one actually substituted into Used(). A reference that still resolves to
// nothing — a stale id, a typo, a secret whose decrypt failed — is left verbatim; this package
// never fails a caller over one unresolved reference (D10 mirrors P9 D10's own rule), the server's
// own response is the honest signal.
func (r *Resolver) Text(text string) string {
	return r.text(text, nil)
}

// URLText is Text's twin for the one field with query-string delimiter syntax to break (finding
// 6, v1.2 P14 round 2): a secret whose decrypt failed still resolves to nothing and is left
// verbatim by Text's own contract above, but for the URL specifically that verbatim span must not
// inject a raw space/&/#/= into url.Parse's RawQuery or the request line itself.
func (r *Resolver) URLText(text string) string {
	return r.text(text, urlUnsafeReplacer.Replace)
}

func (r *Resolver) text(text string, sanitize func(string) string) string {
	result := resolveWithSanitizer(text, r.secretValues, nil, sanitize)
	for _, ref := range result.Refs {
		if ref.Kind == KindResolved {
			r.used[ref.Name] = r.secretValues[ref.Name]
		}
	}
	return result.Text
}

// Used is every secret name→value pair actually substituted so far — what a caller's own masking
// replacer (bridge/http.go's secretReplacer, shared unchanged by bridge/grpc.go, D10) is built
// from, so a secret's plaintext is never left in a copyable surface unmasked. nil when nothing was
// substituted, matching ResolveRequest's own pre-extraction contract.
func (r *Resolver) Used() map[string]string {
	if len(r.used) == 0 {
		return nil
	}
	return r.used
}

// ResolveRequest is D6's stage 2, called from bridge/http.go strictly *after* op.SetCommand
// (F3) — the URL/headers/body it is given must never feed back into anything logged or persisted.
// It decrypts every secret variable reachable from collectionID/environmentID
// (repos.VariablesRepo.SecretsFor already applies D2's environment-over-collection precedence)
// and resolves every remaining {{name}} reference across the same field list D7 gives stage 1. A
// reference that still resolves to nothing — a stale id, a typo, a secret whose decrypt failed —
// is left verbatim; Go never fails a send over one unresolved reference (D10), the server's own
// response is the honest signal.
//
// P11 D9/F21: reimplemented on Resolver above — behaviour-identical (its own tests pass unedited).
//
// P9 D6/F11: the fourth return, `used`, is every secret name→value pair actually substituted —
// the same resolvedNames set this function already built for its own Debug log, widened to carry
// the value too. bridge/http.go builds a strings.Replacer from it and masks P9's rendered exchange
// back to {{name}}, so a secret's plaintext is never left in a copyable surface unmasked.
func (s *Service) ResolveRequest(
	url string, headers []httpclient.Header, body httpclient.Body, collectionID, environmentID string,
) (string, []httpclient.Header, httpclient.Body, map[string]string, error) {
	hasAnyReference := false
	for _, field := range referencedFields(url, headers, body) {
		if len(Names(field)) > 0 {
			hasAnyReference = true
			break
		}
	}
	if !hasAnyReference {
		return url, headers, body, nil, nil
	}

	resolver, err := s.NewResolver(collectionID, environmentID)
	if err != nil {
		return url, headers, body, nil, err
	}
	if !resolver.Any() {
		return url, headers, body, nil, nil
	}

	resolvedURL := resolver.URLText(url)
	resolvedHeaders := make([]httpclient.Header, len(headers))
	for i, h := range headers {
		resolvedHeaders[i] = httpclient.Header{Name: resolver.Text(h.Name), Value: resolver.Text(h.Value)}
	}

	resolvedBody := body
	switch body.Mode {
	case string(httpclient.BodyRaw):
		resolvedBody.Raw = resolver.Text(body.Raw)
	case string(httpclient.BodyCode):
		resolvedBody.Code = resolver.Text(body.Code)
	case string(httpclient.BodyURLEncoded):
		fields := make([]httpclient.Field, len(body.URLEncoded))
		for i, f := range body.URLEncoded {
			fields[i] = httpclient.Field{Name: resolver.Text(f.Name), Value: resolver.Text(f.Value)}
		}
		resolvedBody.URLEncoded = fields
	case string(httpclient.BodyFormData):
		fields := make([]httpclient.FormField, len(body.FormData))
		for i, f := range body.FormData {
			out := f
			out.Name = resolver.Text(f.Name)
			out.ContentType = resolver.Text(f.ContentType)
			if f.Kind == "text" {
				out.Value = resolver.Text(f.Value)
			}
			// D7: a form-data file row's path is never substituted.
			fields[i] = out
		}
		resolvedBody.FormData = fields
	}

	used := resolver.Used()
	// D5: the count and the *names* of the secrets resolved, never their values, and only at
	// Debug — connections.Service.Reveal's own "the subject, not the secret" precedent.
	if len(used) > 0 {
		names := make([]string, 0, len(used))
		for name := range used {
			names = append(names, name)
		}
		slog.Debug("resolved secret references for a send", "scope", "apivars", "count", len(names), "names", names)
	}

	return resolvedURL, resolvedHeaders, resolvedBody, used, nil
}
