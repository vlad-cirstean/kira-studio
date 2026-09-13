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

// IsDynamicReference is the Go twin of packages/api-core/src/http/substitute.ts's own
// isDynamicReference (P17 D12) — a name is dynamic-shaped if it is `$`-prefixed (Postman's own
// spelling) or `fake.`-prefixed (this app's additive, permanent alias namespace, never a
// migration of the former).
func IsDynamicReference(name string) bool {
	return strings.HasPrefix(name, "$") || strings.HasPrefix(name, "fake.")
}

// Reference is one {{name}} reference Resolve found, and how it was classified.
type Reference struct {
	Name string
	Kind ReferenceKind
	// Pipeline is the transform names, left to right — nil for today's references (P17 D4), which
	// is what keeps the shared corpus (testdata/substitution.json) comparing field-by-field with no
	// edit for every case that predates the pipe grammar.
	Pipeline []string
}

// ParsedReference is ParseReference's answer: the bare reference name and its optional transform
// pipeline, split out of the already-extracted, already-trimmed text between `{{` and `}}` (P17
// D3). The TS twin is packages/api-core/src/http/substitute.ts's own parseReference — same rules,
// pinned by the same corpus.
type ParsedReference struct {
	// Name is the bare reference name — what classifyReference, Names, and every downstream
	// consumer (the reveal loop, the masking replacer) key on. Unchanged from today for a
	// reference with no pipeline.
	Name string
	// Pipeline is the transform names, left to right. Empty for today's references.
	Pipeline []string
	// Normalized is the span text `{{name | a | b}}`, one space either side of each `|`,
	// regardless of how it was typed — D9's masking placeholder, and nothing else.
	Normalized string
}

// ParseReference splits inner — the already-extracted, already-trimmed text between `{{` and
// `}}` — into a bare name and an optional transform pipeline (P17 D3), by the same all-or-nothing
// rule the TS twin implements:
//
//  1. No `|` at all: today's behaviour exactly — {Name: inner, Pipeline: nil}.
//  2. Otherwise split on `|` and trim each segment. If the first segment is non-empty and every
//     segment after it is a known transform (IsTransformName), the parse succeeds.
//  3. Otherwise the whole of inner is the name, exactly as today, pipeline empty — the
//     backward-compatibility rule: a variable literally named `a|b` keeps resolving, and a
//     typo'd `{{token | base46}}` becomes an unknown reference named `token | base46` rather than
//     a half-parsed pipeline.
func ParseReference(inner string) ParsedReference {
	if !strings.Contains(inner, "|") {
		return ParsedReference{Name: inner, Normalized: "{{" + inner + "}}"}
	}
	rawSegments := strings.Split(inner, "|")
	segments := make([]string, len(rawSegments))
	for i, s := range rawSegments {
		segments[i] = strings.TrimSpace(s)
	}
	name := segments[0]
	rest := segments[1:]
	allTransforms := true
	for _, seg := range rest {
		if !IsTransformName(seg) {
			allTransforms = false
			break
		}
	}
	if name != "" && allTransforms {
		normalized := "{{" + strings.Join(append([]string{name}, rest...), " | ") + "}}"
		return ParsedReference{Name: name, Pipeline: rest, Normalized: normalized}
	}
	return ParsedReference{Name: inner, Normalized: "{{" + inner + "}}"}
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
	return resolveWithSanitizer(text, values, secretNames, nil, nil)
}

// urlUnsafeReplacer is the Go twin of packages/api-core/src/http/substitute.ts's own
// sanitizeUrlSpan (finding 6, v1.2 P14 round 2) — percent-encodes only the characters that would
// otherwise break url.Parse's RawQuery or the request line itself (a space is what actually turns
// a send into a 400; &/#/= are the query string's own structural delimiters), leaving `{{`/`}}`
// and the reference name's ordinary characters exactly as typed. P17 D11: `|` joins the set — it
// is not a legal URL character and a literal `|` in a request line is finding 6's own class.
var urlUnsafeReplacer = strings.NewReplacer(
	" ", "%20", "\t", "%09", "\r", "%0D", "\n", "%0A",
	"&", "%26", "#", "%23", "=", "%3D", "|", "%7C",
)

// resolveWithSanitizer is Resolve's real body — sanitize, when non-nil, is applied to a reference
// span left literal because it will never be resolved by anyone downstream: KindUnknown (no such
// name — including a secret whose decrypt failed, since Resolver.Text always calls this with
// secretNames nil, so a still-missing secret name falls into this same branch) and KindDynamic (Go
// never generates a `{{$name}}` value itself — P6's generator is JS-only). Deliberately never
// applied to KindDeferred: a later pass elsewhere still has to find that span by its exact,
// untouched name and pipeline.
//
// P17 D6/D9: onResolved, when non-nil, is called exactly once per KindResolved reference with the
// *rendered* text this function actually wrote (the pipeline already applied) and the
// *normalized* placeholder it should be masked back to (ParseReference's own Normalized —
// `{{name}}` or `{{name | base64}}`, one space either side of `|` regardless of how it was
// typed). It exists so Resolver.text (below) can record what reached the wire without ever
// putting that text on a Reference, which is reported outward. D8: dynamic's generator is still
// invoked once per occurrence, at this same point in the walk — the pipeline wraps only its
// return value.
func resolveWithSanitizer(text string, values map[string]string, secretNames []string, sanitize func(string) string, onResolved func(ref Reference, rendered, placeholder string)) SubstitutionResult {
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
		inner := strings.TrimSpace(text[open+2 : closeAt])
		span := text[open : closeAt+2]
		i = closeAt + 2

		if inner == "" {
			out.WriteString(span)
			continue
		}
		parsed := ParseReference(inner)
		name := parsed.Name
		pipeline := parsed.Pipeline

		pushRef := func(kind ReferenceKind) Reference {
			ref := Reference{Name: name, Kind: kind, Pipeline: pipeline}
			refs = append(refs, ref)
			return ref
		}

		switch {
		case IsDynamicReference(name):
			// D6 dynamic row: Go never generates a `{{$name}}`/`{{fake.x.y}}` value itself (P6's
			// generator is JS-only) — so a dynamic reference here is always left verbatim, with
			// its own pipeline untouched, exactly as stage 1's own uncatalogued-generator branch
			// does.
			pushRef(KindDynamic)
			out.WriteString(sanitizeOrVerbatim(span))
		case secrets[name]:
			// Never sanitized, never transformed here: stage 2 (Resolver.text below) is the pass
			// that finds this exact span, decrypts the secret and applies its pipeline.
			pushRef(KindDeferred)
			out.WriteString(span)
		default:
			if value, ok := values[name]; ok {
				rendered, applyOk := ApplyPipeline(pipeline, value)
				if !applyOk {
					// D5: a transform that cannot be applied leaves the entire span verbatim and
					// classifies the reference unknown.
					pushRef(KindUnknown)
					out.WriteString(sanitizeOrVerbatim(span))
					break
				}
				ref := pushRef(KindResolved)
				if onResolved != nil {
					onResolved(ref, rendered, parsed.Normalized)
				}
				out.WriteString(rendered)
			} else {
				pushRef(KindUnknown)
				out.WriteString(sanitizeOrVerbatim(span))
			}
		}
	}
	return SubstitutionResult{Text: out.String(), Refs: refs}
}

// Names returns every distinct {{name}} reference in text, in first-seen order — the same scan
// with no lookup and no classification. ResolveRequest uses it to decide, before ever querying a
// secret, whether a field references anything at all. P17 D4: the *bare* name (ParseReference's
// own) — a pre-send "does this field reference anything" check counts `{{token | base64}}` as
// referencing `token`.
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
		inner := strings.TrimSpace(text[open+2 : closeAt])
		i = closeAt + 2
		if inner == "" {
			continue
		}
		name := ParseReference(inner).Name
		if seen[name] {
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
	used         []UsedSecret
	usedSeen     map[string]bool
}

// UsedSecret is one substituted secret span: the text actually written into the request, and the
// placeholder it is masked back to (P17 D9, §5 of the plan). Rendered is a secret's plaintext ONLY
// when the span carried no pipeline — with one, it is the transformed form (base64, upper-cased,
// URL-encoded…), which is exactly as sensitive and is what a caller's masking replacer must
// register instead of the plaintext, or a pipe reopens finding 6/finding 4's exact bug class one
// encoding later (§5.2).
type UsedSecret struct {
	// Name is the secret's variable name — used for the Debug log (names only, D5) and for
	// counting distinct secrets (Wire.MaskedSecrets counts names, not entries, D9(e)).
	Name string
	// Rendered is the exact text this substitution wrote onto the wire — the plaintext when the
	// span had no pipeline, the transformed form otherwise. Comes from the substitution walk
	// itself (the onResolved callback), never re-derived, so the masking input and the wire
	// content share one source by construction.
	Rendered string
	// Placeholder is ParseReference's own Normalized span — "{{name}}" or
	// "{{name | base64}}" — what Rendered is masked back to. Normalized (single spaces) rather
	// than the user's exact spacing, so two spellings of one span do not produce two placeholders
	// for identical wire bytes.
	Placeholder string
}

// NewResolver fetches every secret reachable from collectionID/environmentID once
// (repos.VariablesRepo.SecretsFor already applies D2's environment-over-collection precedence)
// and returns a resolver that substitutes text and accumulates what it actually used.
func (s *Service) NewResolver(collectionID, environmentID string) (*Resolver, error) {
	secretValues, err := s.deps.Repo.SecretsFor(collectionID, environmentID)
	if err != nil {
		return nil, err
	}
	return &Resolver{secretValues: secretValues, usedSeen: map[string]bool{}}, nil
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
	// P17 D9(b): the rendered text and its placeholder reach this resolver through
	// resolveWithSanitizer's own onResolved callback, called from inside the substitution walk —
	// never through a field on Reference, which is reported outward and must never carry a
	// secret's rendered form. One entry per distinct (Name, Placeholder) pair (D9(d)): a request
	// using both {{token}} and {{token | base64}} records two entries, so both wire forms get
	// masked — a name-keyed map could not represent this.
	onResolved := func(ref Reference, rendered, placeholder string) {
		key := ref.Name + "\x00" + placeholder
		if r.usedSeen[key] {
			return
		}
		r.usedSeen[key] = true
		r.used = append(r.used, UsedSecret{Name: ref.Name, Rendered: rendered, Placeholder: placeholder})
	}
	result := resolveWithSanitizer(text, r.secretValues, nil, sanitize, onResolved)
	return result.Text
}

// Used is every secret span actually substituted so far, one entry per distinct (Name,
// Placeholder) pair — what a caller's own masking replacer (bridge/http.go's secretReplacer,
// shared unchanged by bridge/grpc.go, D10) is built from, so a secret's plaintext or any
// transformed form of it a pipe produced is never left in a copyable surface unmasked (D9, §5).
// nil when nothing was substituted, matching ResolveRequest's own pre-extraction contract.
func (r *Resolver) Used() []UsedSecret {
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
// P9 D6/F11, widened by P17 D9/D10: the fourth return, `used`, is every secret span actually
// substituted — Resolver.Used()'s own []UsedSecret, one entry per distinct (name, placeholder)
// pair. bridge/http.go builds a strings.Replacer from it and masks P9's rendered exchange back to
// each entry's Placeholder, so neither a secret's plaintext nor any transformed form of it a pipe
// produced is ever left in a copyable surface unmasked (§5).
func (s *Service) ResolveRequest(
	url string, headers []httpclient.Header, body httpclient.Body, collectionID, environmentID string,
) (string, []httpclient.Header, httpclient.Body, []UsedSecret, error) {
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
	// D5: the count and the *names* of the secrets resolved (deduplicated — a secret used both
	// plainly and piped is still one name), never their values or rendered forms, and only at
	// Debug — connections.Service.Reveal's own "the subject, not the secret" precedent.
	if len(used) > 0 {
		seenNames := make(map[string]bool, len(used))
		names := make([]string, 0, len(used))
		for _, u := range used {
			if seenNames[u.Name] {
				continue
			}
			seenNames[u.Name] = true
			names = append(names, u.Name)
		}
		slog.Debug("resolved secret references for a send", "scope", "apivars", "count", len(names), "names", names)
	}

	return resolvedURL, resolvedHeaders, resolvedBody, used, nil
}
