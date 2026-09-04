package httpvars

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

// Resolve is the Go twin of frontend/src/http/substitute.ts's own `resolve` — the identical
// two-token grammar (D17), pinned to the same behaviour by testdata/substitution.json (D18).
//
// The grammar, in full: scan for `{{`; from there scan for the next `}}`; no `}}` ⇒ the rest of
// the string is literal and the scan ends. The name is the text between, trimmed; an empty name
// is not a reference. Nesting is not a thing — `{{a{{b}}}}` takes `a{{b` as the name, finds
// nothing, and passes through literally. One pass only: a resolved value that itself contains
// `{{other}}` is never re-expanded.
func Resolve(text string, values map[string]string, secretNames []string) SubstitutionResult {
	secrets := make(map[string]bool, len(secretNames))
	for _, n := range secretNames {
		secrets[n] = true
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
			out.WriteString(span)
		case secrets[name]:
			refs = append(refs, Reference{Name: name, Kind: KindDeferred})
			out.WriteString(span)
		default:
			if value, ok := values[name]; ok {
				refs = append(refs, Reference{Name: name, Kind: KindResolved})
				out.WriteString(value)
			} else {
				refs = append(refs, Reference{Name: name, Kind: KindUnknown})
				out.WriteString(span)
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

// ResolveRequest is D6's stage 2, called from bridge/http.go strictly *after* op.SetCommand
// (F3) — the URL/headers/body it is given must never feed back into anything logged or persisted.
// It decrypts every secret variable reachable from collectionID/environmentID
// (repos.VariablesRepo.SecretsFor already applies D2's environment-over-collection precedence)
// and resolves every remaining {{name}} reference across the same field list D7 gives stage 1. A
// reference that still resolves to nothing — a stale id, a typo, a secret whose decrypt failed —
// is left verbatim; Go never fails a send over one unresolved reference (D10), the server's own
// response is the honest signal.
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

	secretValues, err := s.deps.Repo.SecretsFor(collectionID, environmentID)
	if err != nil {
		return url, headers, body, nil, err
	}
	if len(secretValues) == 0 {
		return url, headers, body, nil, nil
	}

	used := map[string]string{}
	resolveText := func(text string) string {
		result := Resolve(text, secretValues, nil)
		for _, ref := range result.Refs {
			if ref.Kind == KindResolved {
				used[ref.Name] = secretValues[ref.Name]
			}
		}
		return result.Text
	}

	resolvedURL := resolveText(url)
	resolvedHeaders := make([]httpclient.Header, len(headers))
	for i, h := range headers {
		resolvedHeaders[i] = httpclient.Header{Name: resolveText(h.Name), Value: resolveText(h.Value)}
	}

	resolvedBody := body
	switch body.Mode {
	case string(httpclient.BodyRaw):
		resolvedBody.Raw = resolveText(body.Raw)
	case string(httpclient.BodyCode):
		resolvedBody.Code = resolveText(body.Code)
	case string(httpclient.BodyURLEncoded):
		fields := make([]httpclient.Field, len(body.URLEncoded))
		for i, f := range body.URLEncoded {
			fields[i] = httpclient.Field{Name: resolveText(f.Name), Value: resolveText(f.Value)}
		}
		resolvedBody.URLEncoded = fields
	case string(httpclient.BodyFormData):
		fields := make([]httpclient.FormField, len(body.FormData))
		for i, f := range body.FormData {
			out := f
			out.Name = resolveText(f.Name)
			out.ContentType = resolveText(f.ContentType)
			if f.Kind == "text" {
				out.Value = resolveText(f.Value)
			}
			// D7: a form-data file row's path is never substituted.
			fields[i] = out
		}
		resolvedBody.FormData = fields
	}

	// D5: the count and the *names* of the secrets resolved, never their values, and only at
	// Debug — connections.Service.Reveal's own "the subject, not the secret" precedent.
	if len(used) > 0 {
		names := make([]string, 0, len(used))
		for name := range used {
			names = append(names, name)
		}
		slog.Debug("resolved secret references for a send", "scope", "httpvars", "count", len(names), "names", names)
	}

	return resolvedURL, resolvedHeaders, resolvedBody, used, nil
}
