package apivars

import (
	"encoding/base64"
	"net/url"
	"strings"
	"unicode/utf8"
)

// P17 D7/D2: the Go twin of packages/api-core/src/http/transforms.ts — the six-transform closed
// vocabulary a `{{name | transform}}` pipe may apply, byte-identical to the TS side and pinned by
// the same shared corpus (F1). Exactly six, zero-argument, closed (OQ-2 declines arguments).
//
// transformNames is read as plain text by packages/api-core/test/go-ts-api-parity.spec.ts
// (extractGoStringSet) — its shape (a `map[string]bool` literal, one `"name": true` per line) must
// stay exactly this, or that parity check breaks.
var transformNames = map[string]bool{
	"base64":       true,
	"base64decode": true,
	"upper":        true,
	"lower":        true,
	"urlencode":    true,
	"urldecode":    true,
}

// IsTransformName reports whether name is one of the six closed-vocabulary transforms.
func IsTransformName(name string) bool {
	return transformNames[name]
}

// applyTransform is one step of ApplyPipeline. D7's table: base64/base64decode round-trip
// standard, padded base64; base64decode additionally requires the decoded bytes be valid UTF-8
// (matching TS's `TextDecoder('utf-8', {fatal: true})`) — invalid base64 *or* invalid UTF-8 is a
// failure (D5). upper/lower never fail. urlencode/urldecode are url.QueryEscape/QueryUnescape
// verbatim — the escaper this repo already uses for a urlencoded body (P12 D7).
func applyTransform(name, s string) (string, bool) {
	switch name {
	case "base64":
		return base64.StdEncoding.EncodeToString([]byte(s)), true
	case "base64decode":
		decoded, err := base64.StdEncoding.DecodeString(s)
		if err != nil || !utf8.Valid(decoded) {
			return "", false
		}
		return string(decoded), true
	case "upper":
		return strings.ToUpper(s), true
	case "lower":
		return strings.ToLower(s), true
	case "urlencode":
		return url.QueryEscape(s), true
	case "urldecode":
		decoded, err := url.QueryUnescape(s)
		if err != nil {
			return "", false
		}
		return decoded, true
	default:
		return "", false
	}
}

// ApplyPipeline applies each transform in pipeline to value, left to right (D7's chaining rule),
// returning ok=false the instant any step fails (D5: nothing is emitted half-transformed). An
// empty pipeline returns value unchanged. Every name in pipeline is expected to already be a valid
// transform (ParseReference only ever produces one) — an unrecognised name here is itself treated
// as a failure rather than a panic, so a future caller passing an unvalidated pipeline fails safe.
func ApplyPipeline(pipeline []string, value string) (string, bool) {
	out := value
	for _, name := range pipeline {
		applied, ok := applyTransform(name, out)
		if !ok {
			return "", false
		}
		out = applied
	}
	return out, true
}
