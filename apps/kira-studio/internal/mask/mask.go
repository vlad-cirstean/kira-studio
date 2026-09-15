// Package mask implements M5's PII masking scheme (docs/v1.7/plans/M5-anonymization-masking.md
// §2-§4): a partial redaction of one cell's text, plus an optional keyed correlation tag riding
// alongside it. A leaf package — stdlib and github.com/rivo/uniseg only, no dependency on dbmcp,
// page or storage/model — so packages/shared/domain/mask.ts's TypeScript port can mirror it
// function for function and the two are pinned against one shared fixture set (§5).
//
// The design, restated briefly (the plan's §2 has the actual reasoning): masking is not hashing —
// a redacted character is discarded, never transformed, so there is nothing for an attacker to
// invert. The correlation tag is the one place a secret key is involved, and it never influences
// which characters a redaction keeps (that would be a side channel, §2.6) — it only proves that two
// equal real values produced the same masked output, for a join to survive.
package mask

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base32"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/rivo/uniseg"
)

// Kind is one of the six PII classes this package masks. §2.3's plan draft also defined an `id`
// kind (identifier columns, tag-only); it was dropped before implementation — internal ids are not
// PII and no rule should apply to them at all, so a column meant to stay untouched simply carries
// no rule, rather than one whose kind happens to be a no-op.
type Kind string

const (
	KindName   Kind = "name"
	KindEmail  Kind = "email"
	KindText   Kind = "text"
	KindNumber Kind = "number"
	KindDate   Kind = "date"
	KindRedact Kind = "redact"
)

// Rule is one column's masking configuration — the plain-stdlib mirror of model.MaskRuleFields,
// carrying only what Apply needs (never a table/column name: §4's own matching happens one layer
// up, before Apply is ever called).
type Rule struct {
	Kind Kind
	// KeepHint controls each kind's own small hint (§2.3): the initials for name, the domain for
	// email, the year for date. Meaningless for text/number/id/redact.
	KeepHint bool
	// Correlate emits the keyed correlation tag (§2.4) alongside the redaction. Always false in
	// effect for KindNumber (Apply enforces this itself, defensively, on top of the storage-layer
	// validation that already forces it) — a bucket is many-to-one, so a tag on it would be
	// dishonest.
	Correlate bool
}

// redactLiteral is §2.3's universal fall-through target and KindRedact's own visible output.
const redactLiteral = "[redacted]"

// bullet is the redaction glyph (§2.3): U+2022, not `*`, which reads as SQL/shell syntax in a
// result a model might compose against.
const bullet = "•"

// Masker holds one connection's resolved correlation key (§2.5). A zero-value key (nil or empty)
// means no rule on this connection correlates — New(nil) is valid, and Apply then never calls tag.
type Masker struct{ key []byte }

// New constructs a Masker over key — 32 random bytes minted by internal/maskrules, or nil when no
// correlating rule exists on the connection yet.
func New(key []byte) *Masker { return &Masker{key: key} }

// Apply masks one non-NULL cell. Total: every (Rule, value) pair produces an output, and no path
// returns value unchanged except the universal empty-string identity (§2.3) — NULL itself never
// reaches Apply; the caller (dbmcp's renderTabularPage, the grid's preview transform) checks for it
// first and leaves a NULL cell untouched.
func (m *Masker) Apply(r Rule, value string) string {
	if value == "" {
		return ""
	}
	visible := m.maskVisible(r, value)
	// §2.3: "A number never carries a correlation tag" — enforced here too, not only at the
	// storage-layer validation that sets Correlate=false for a number rule, so a legacy or
	// hand-edited row can never smuggle one through.
	if r.Kind == KindNumber || !r.Correlate || m == nil || len(m.key) == 0 {
		return visible
	}
	return visible + m.tag(value)
}

// MaskNullable applies Apply to value's own content when value is non-nil, and passes NULL through
// unchanged otherwise (§2.3's "NULL is never masked" — masking a NULL would invent a value that is
// not there). The one function both consumption points (dbmcp's renderTabularPage, the grid's
// preview transform) call, so the nil check lives in exactly one place per language rather than
// being re-implemented at each call site — and so the parity fixture set's own NULL case exercises
// one real function on both sides instead of asserting an unenforced convention.
func (m *Masker) MaskNullable(r Rule, value *string) *string {
	if value == nil {
		return nil
	}
	out := m.Apply(r, *value)
	return &out
}

// maskVisible dispatches by kind and returns the redaction alone, before any tag is appended.
// Every arm is total — an unhandled or invalid Kind falls to the same redactLiteral a real `redact`
// rule produces (§2.3's "fail closed, everywhere, with no exceptions").
func (m *Masker) maskVisible(r Rule, value string) string {
	switch r.Kind {
	case KindName:
		return maskName(value, r.KeepHint)
	case KindEmail:
		return maskEmail(value, r.KeepHint)
	case KindText:
		return maskText(value)
	case KindNumber:
		return maskNumber(value)
	case KindDate:
		return maskDate(value, r.KeepHint)
	case KindRedact:
		return redactLiteral
	default:
		return redactLiteral
	}
}

// maskName keeps each whitespace-separated word's first grapheme (when keepHint) plus its own
// grapheme length, destroying every other character (§2.3 `name`). A value with no words at all
// (empty after trimming whitespace — not the empty-string case Apply already handled) has no shape
// to preserve honestly, so it falls through to redactLiteral rather than echoing "".
func maskName(value string, keepHint bool) string {
	words := strings.Fields(value)
	if len(words) == 0 {
		return redactLiteral
	}
	parts := make([]string, len(words))
	for i, w := range words {
		parts[i] = maskWord(w, keepHint)
	}
	return strings.Join(parts, " ")
}

// maskWord masks one word: first grapheme + bullet run when keepHint, an all-bullet run of the
// same grapheme length otherwise. A single-grapheme word (n==1) always gets the all-bullet form,
// regardless of keepHint — "keep the first grapheme, destroy the rest" has zero characters left to
// destroy when the whole word is one grapheme, so honouring keepHint there would echo the word back
// whole (caught by TestApplyNeverEchoesOriginalText). The length hint survives intact either way (a
// single bullet still says "one grapheme"); only the content does not.
func maskWord(w string, keepHint bool) string {
	n := uniseg.GraphemeClusterCount(w)
	if n == 0 {
		return ""
	}
	if !keepHint || n == 1 {
		return strings.Repeat(bullet, n)
	}
	first, _, _, _ := uniseg.FirstGraphemeClusterInString(w, -1)
	return first + strings.Repeat(bullet, n-1)
}

// maskEmail keeps the domain (in full, when keepHint) and the local part's first grapheme + length
// (§2.3 `email`). A value with no `@` is not an email — it falls through to maskName's own shape,
// never emitting more than that would (§2.3's own stated fallback, an exception to the universal
// "falls through to redact" rule, made explicit here rather than left implicit).
func maskEmail(value string, keepHint bool) string {
	i := strings.LastIndexByte(value, '@')
	if i < 0 {
		return maskName(value, keepHint)
	}
	local, domain := value[:i], value[i+1:]
	localMasked := maskWord(local, keepHint)
	domainMasked := domain
	if !keepHint {
		domainMasked = strings.Repeat(bullet, uniseg.GraphemeClusterCount(domain))
	}
	return localMasked + "@" + domainMasked
}

// maskText keeps nothing but a bucketed length (§2.3 `text`) — no first character, no exact
// length, both of which are themselves fingerprints over free text.
func maskText(value string) string {
	n := uniseg.GraphemeClusterCount(value)
	return bullet + bullet + bullet + " (text, " + lengthBucket(n) + " chars)"
}

// textBucketEdges are the fixed, data-independent boundaries §2.3 names: 0 exactly, then doubling
// from 8. Never derived from the column's own distribution — a quantile bucket would leak it.
var textBucketEdges = []int{1, 8, 16, 32, 64, 128, 256, 512}

// lengthBucket maps a grapheme count to its bucket label ("1-8", "8-16", ... "512+" — §2.3's own
// literal names). Exported (capitalised name) would invite callers to bypass Apply's own dispatch;
// kept unexported and reached only through maskText and its own tests.
func lengthBucket(n int) string {
	if n <= 0 {
		return "0"
	}
	for i := 1; i < len(textBucketEdges); i++ {
		if n < textBucketEdges[i] {
			return strconv.Itoa(textBucketEdges[i-1]) + "-" + strconv.Itoa(textBucketEdges[i])
		}
	}
	last := textBucketEdges[len(textBucketEdges)-1]
	return strconv.Itoa(last) + "+"
}

// maskNumber keeps the sign and a fixed decade range (§2.3 `number`), never a digit. A value that
// does not parse as a number falls through to redactLiteral — never an echo, and (per Apply) never
// a tag either, kind-number cells are never joinable.
func maskNumber(value string) string {
	r, ok := decadeRange(value)
	if !ok {
		return redactLiteral
	}
	return r
}

// plainDecimalRE matches an unsigned plain decimal literal — digits, optionally one `.` and more
// digits. Anything else (scientific notation, thousands separators, garbage) falls back to the
// float-based exponent below rather than the exact string-digit method, which needs this shape to
// stay exact.
var plainDecimalRE = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?$`)

// decadeRange formats value's own fixed-power-of-ten bucket (§2.3/§2.4's own "boundaries are fixed
// powers of ten, never data-derived"). ok is false when value does not parse as a real number at
// all (adapters.Error-free — this package never touches the adapter layer).
func decadeRange(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	v, err := strconv.ParseFloat(trimmed, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return "", false
	}
	if v == 0 {
		return "0", true
	}
	neg := v < 0
	absVal := v
	if neg {
		absVal = -v
	}
	absStr := trimmed
	if neg {
		absStr = strings.TrimPrefix(absStr, "-")
	} else {
		absStr = strings.TrimPrefix(absStr, "+")
	}
	k := decadeExponent(absStr, absVal)
	lower := pow10String(k)
	upper := pow10String(k + 1)
	if neg {
		return "(-" + upper + "--" + lower + "]", true
	}
	return "[" + lower + "-" + upper + ")", true
}

// decadeExponent returns k such that 10^k <= absVal < 10^(k+1), computed by counting digits in
// absStr rather than via math.Log10 whenever absStr is a plain decimal literal — log10 of an exact
// power of ten can land a hair under the true integer (e.g. log10(100) as 1.999999999999998),
// which would silently misfile a boundary value into the wrong decade. The float-based fallback
// only runs for a shape plainDecimalRE does not recognise (scientific notation and the like), where
// exactness at a decade boundary is not a documented guarantee.
func decadeExponent(absStr string, absVal float64) int {
	if plainDecimalRE.MatchString(absStr) {
		intPart, fracPart, hasDot := absStr, "", false
		if i := strings.IndexByte(absStr, '.'); i >= 0 {
			intPart, fracPart, hasDot = absStr[:i], absStr[i+1:], true
		}
		intPart = strings.TrimLeft(intPart, "0")
		if intPart != "" {
			return len(intPart) - 1
		}
		if hasDot {
			lead := 0
			for lead < len(fracPart) && fracPart[lead] == '0' {
				lead++
			}
			return -(lead + 1)
		}
	}
	return int(math.Floor(math.Log10(absVal)))
}

// pow10String renders 10^k exactly, as a decimal string — never via float64 math.Pow10, which
// cannot represent most negative powers of ten exactly and would print a boundary like "0.1" as
// "0.09999999999999999" instead.
func pow10String(k int) string {
	if k >= 0 {
		return "1" + strings.Repeat("0", k)
	}
	return "0." + strings.Repeat("0", -k-1) + "1"
}

// dateLeadingYearRE recognises a leading ISO-8601 YYYY-MM-DD — the shape both examples in §2.3 use.
// Anything else (a different calendar notation, a bare year, garbage) is not confidently a date and
// falls through to maskText rather than guessing at a shape to preserve.
var dateLeadingYearRE = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`)

// maskDate keeps the year (when keepHint) and destroys every digit after it — month, day, and
// every time component — while preserving every separator (`-`, `T`, `:`, `.`, `Z`, an offset sign)
// so the output still shows the value's own granularity, per §2.3 `date`.
func maskDate(value string, keepHint bool) string {
	if !dateLeadingYearRE.MatchString(value) {
		return maskText(value)
	}
	year := value[:4]
	if !keepHint {
		year = strings.Repeat(bullet, 4)
	}
	return year + destroyDigits(value[4:])
}

func destroyDigits(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if unicode.IsDigit(r) {
			b.WriteString(bullet)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// crockfordAlphabet excludes I, L, O, U (§2.4) so a tag never reads as a word and never confuses
// 0/O when a human retypes it.
const crockfordAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

var crockfordEncoding = base32.NewEncoding(crockfordAlphabet).WithPadding(base32.NoPadding)

// tag computes "#" + crockfordBase32(HMAC-SHA256(key, value))[0:6] exactly per §2.4. The HMAC
// message is value's raw UTF-8 bytes alone — no column name, no table name, no rule identity mixed
// in, which is what lets `customers.id` and `orders.customer_id` tag identically for the same
// customer (§2.4's own stated invariant, load-bearing for the join the whole design exists for).
func (m *Masker) tag(value string) string {
	h := hmac.New(sha256.New, m.key)
	h.Write([]byte(value))
	sum := h.Sum(nil)
	encoded := crockfordEncoding.EncodeToString(sum)
	if len(encoded) < 6 {
		// Unreachable in practice (sum is always 32 bytes, encoding to far more than 6 chars) —
		// kept so a future change to the hash size cannot panic here.
		return "#" + encoded
	}
	return "#" + encoded[:6]
}

// kindStrictness ranks the six kinds from most to least redacting (§4.2's conflict-folding order):
// redact > text > date > email > name > number. Lower rank wins a conflict, the same "lowest rank
// is strictest" convention dbmcp/permissions.go's strictnessRank already uses.
var kindStrictness = map[Kind]int{
	KindRedact: 0,
	KindText:   1,
	KindDate:   2,
	KindEmail:  3,
	KindName:   4,
	KindNumber: 5,
}

// Stricter returns whichever of a, b is the stricter rule (§4.2): the lower-ranked kind first, and
// within one kind, KeepHint=false beats KeepHint=true and Correlate=false beats Correlate=true — an
// ambiguity between two rules matching the same column name (under different table_name values)
// must never resolve to the more permissive option.
func Stricter(a, b Rule) Rule {
	ra, ok := kindStrictness[a.Kind]
	if !ok {
		ra = kindStrictness[KindRedact]
	}
	rb, ok := kindStrictness[b.Kind]
	if !ok {
		rb = kindStrictness[KindRedact]
	}
	if ra != rb {
		if ra < rb {
			return a
		}
		return b
	}
	// Same kind: fold the two flags independently, each toward its own stricter (more redacting)
	// value — not "prefer a wholesale" — so e.g. a.KeepHint=false, b.Correlate=false folds to both
	// false even though neither single rule had both.
	return Rule{
		Kind:      a.Kind,
		KeepHint:  a.KeepHint && b.KeepHint,
		Correlate: a.Correlate && b.Correlate,
	}
}

// Set is one connection's resolved masking state (§4.2/§4.6): the already-folded rule for every
// masked column name (lowercased), and the Masker any of them that correlate need. A Set with no
// Rules behaves as "no masking configured" — dbmcp's own render path treats a nil *Set exactly the
// same way, before this type is ever constructed.
type Set struct {
	Masker *Masker
	// Rules maps a lowercased column name to its single, already-folded rule (§4.2: matching is by
	// column name alone, case-insensitively, across every rule on the connection, ignoring
	// table_name).
	Rules map[string]Rule
}

// Empty reports whether this Set carries no rules at all.
func (s Set) Empty() bool { return len(s.Rules) == 0 }

// RuleFor looks up column case-insensitively.
func (s Set) RuleFor(column string) (Rule, bool) {
	if len(s.Rules) == 0 {
		return Rule{}, false
	}
	r, ok := s.Rules[strings.ToLower(column)]
	return r, ok
}

// ApplyColumn masks value for column if a rule matches it (matched=true), or returns value
// unchanged (matched=false) when none does — dbmcp's per-cell entry point, resolved once per
// column per page (§4.2's own cost rule), never per row. NULL passes straight through, via
// MaskNullable, without ever consulting a rule.
func (s Set) ApplyColumn(column string, value *string) (out *string, matched bool) {
	if value == nil {
		return nil, false
	}
	r, ok := s.RuleFor(column)
	if !ok {
		return value, false
	}
	masker := s.Masker
	if masker == nil {
		masker = New(nil)
	}
	return masker.MaskNullable(r, value), true
}
