// Package mongo is the native Go adapter for MongoDB (P58c). literal.go is its first file, written
// alone before any driver or container involvement (P58 D11, P58c C4): a hand port of
// src/engine/adapters/mongo/literal.ts, the JSON5-lite tokenizer and BSON-constructor parser every
// Mongo filter/document/console text surface in the app runs through. No eval, no Function, no
// third-party expression evaluator — user-supplied text must never reach one.
package mongo

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
)

// --- tokenizer -------------------------------------------------------------------------------

type tokenType int

const (
	tokPunct tokenType = iota
	tokString
	tokNumber
	tokIdent
	tokEOF
)

// token.pos is a rune index, not a byte offset: it reaches the user in five error messages, and a
// byte offset would name a different position than literal.ts's UTF-16-code-unit one did for any
// text containing a multi-byte character before the error site.
type token struct {
	typ   tokenType
	value string
	pos   int
}

const punctChars = "{}[]:,()."

var escapes = map[rune]rune{
	'n':  '\n',
	't':  '\t',
	'r':  '\r',
	'b':  '\b',
	'f':  '\f',
	'\\': '\\',
	'"':  '"',
	'\'': '\'',
	'/':  '/',
}

func isDigit(r rune) bool { return r >= '0' && r <= '9' }

func isNumberRune(r rune) bool {
	return isDigit(r) || r == '.' || r == 'e' || r == 'E' || r == '+' || r == '-'
}

// isIdentStart/isIdentPart mirror literal.ts's own `/[A-Za-z_$]/`/`/[A-Za-z0-9_$]/` character
// classes exactly — those are ASCII-only literal character classes in JS too, not Unicode
// properties, so no unicode.IsLetter substitute belongs here.
func isIdentStart(r rune) bool {
	return (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || r == '_' || r == '$'
}

func isIdentPart(r rune) bool { return isIdentStart(r) || isDigit(r) }

// jsonQuoteString is JSON.stringify(s) for the tokenizer's own "unexpected character" message —
// encoding/json's default Marshal HTML-escapes '<', '>' and '&', which JSON.stringify never does,
// so escaping is disabled explicitly (the same divergence P58c's own MG-1 probe found in
// MarshalExtJSON and the plan requires disabling there too).
func jsonQuoteString(s string) string {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(s)
	return strings.TrimRight(buf.String(), "\n")
}

func tokenize(text string) ([]token, error) {
	runes := []rune(text)
	n := len(runes)
	var tokens []token
	i := 0
	for i < n {
		c := runes[i]
		if unicode.IsSpace(c) {
			i++
			continue
		}
		if c == '/' && i+1 < n && runes[i+1] == '/' {
			for i < n && runes[i] != '\n' {
				i++
			}
			continue
		}
		if c == '/' && i+1 < n && runes[i+1] == '*' {
			i += 2
			// Walks off the end when unterminated, exactly like literal.ts:46 — a trailing `/*`
			// with no closer is ignored, not rejected, and the `i += 2` below runs regardless.
			for i < n && !(runes[i] == '*' && i+1 < n && runes[i+1] == '/') {
				i++
			}
			i += 2
			continue
		}
		if strings.ContainsRune(punctChars, c) {
			tokens = append(tokens, token{tokPunct, string(c), i})
			i++
			continue
		}
		if c == '"' || c == '\'' {
			quote := c
			j := i + 1
			var sb strings.Builder
			for j < n && runes[j] != quote {
				if runes[j] == '\\' && j+1 < n {
					esc := runes[j+1]
					if esc == 'u' && j+5 < n {
						hex := string(runes[j+2 : j+6])
						code, err := strconv.ParseInt(hex, 16, 32)
						if err == nil {
							sb.WriteRune(rune(code))
						}
						j += 6
						continue
					}
					if r, ok := escapes[esc]; ok {
						sb.WriteRune(r)
					} else {
						// An unknown escape yields the escaped character itself
						// (`ESCAPES[esc] ?? esc`, literal.ts:66).
						sb.WriteRune(esc)
					}
					j += 2
					continue
				}
				sb.WriteRune(runes[j])
				j++
			}
			if j >= n {
				return nil, adapters.New(adapters.CodeQuery, "unterminated string literal", nil)
			}
			tokens = append(tokens, token{tokString, sb.String(), i})
			i = j + 1
			continue
		}
		if isDigit(c) || (c == '-' && i+1 < n && isDigit(runes[i+1])) {
			j := i + 1
			for j < n && isNumberRune(runes[j]) {
				j++
			}
			tokens = append(tokens, token{tokNumber, string(runes[i:j]), i})
			i = j
			continue
		}
		if isIdentStart(c) {
			j := i + 1
			for j < n && isIdentPart(runes[j]) {
				j++
			}
			tokens = append(tokens, token{tokIdent, string(runes[i:j]), i})
			i = j
			continue
		}
		return nil, adapters.New(adapters.CodeQuery,
			fmt.Sprintf("unexpected character %s at position %d", jsonQuoteString(string(c)), i), nil)
	}
	tokens = append(tokens, token{tokEOF, "", n})
	return tokens, nil
}

// --- constructors ------------------------------------------------------------------------------

// jsToString is JS's String(x) over the value shapes ParseValue can hand a constructor argument:
// a string, a float64, a bool, or a parsed null (a nil `any`). hasArg=false is JS's own
// String(undefined) === "undefined" (no bare-call fallback default belongs here: ObjectId() and
// Date() special-case the no-argument form themselves before this ever runs).
func jsToString(arg any, hasArg bool) string {
	if !hasArg {
		return "undefined"
	}
	switch v := arg.(type) {
	case string:
		return v
	case float64:
		return formatJSNumber(v)
	case bool:
		if v {
			return "true"
		}
		return "false"
	case nil:
		return "null"
	default:
		return fmt.Sprintf("%v", v)
	}
}

func formatJSNumber(f float64) string {
	if f == float64(int64(f)) && f < 1e15 && f > -1e15 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}

var isoDateLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02T15:04:05.999",
	"2006-01-02T15:04:05",
	"2006-01-02",
}

func parseISODate(s string) (time.Time, bool) {
	for _, layout := range isoDateLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

// constructorFn builds the value a shell constructor call resolves to. pos is the constructor
// identifier's own token position, for the "invalid date"/"invalid ObjectId" family of errors this
// Go port adds (see the ISODate/Date comment below) — literal.ts has no equivalent message because
// an invalid JS Date silently becomes an "Invalid Date" instead of erroring.
type constructorFn func(arg any, hasArg bool, pos int) (any, error)

// The six-entry table, closed — anything else is a rejected "unrecognized identifier" (no
// bare-word values, literal.ts:98).
var constructors = map[string]constructorFn{
	"ObjectId": func(arg any, hasArg bool, pos int) (any, error) {
		if !hasArg {
			return bson.NewObjectID(), nil
		}
		hex := jsToString(arg, hasArg)
		id, err := bson.ObjectIDFromHex(hex)
		if err != nil {
			return nil, adapters.New(adapters.CodeQuery,
				fmt.Sprintf("invalid ObjectId %q at position %d", hex, pos), err)
		}
		return id, nil
	},
	// ISODate/Date: literal.ts's `new Date(String(arg))` never throws — an unparseable string
	// becomes JS's own "Invalid Date" (getTime() is NaN), which BSON would then encode as a date
	// with a NaN millisecond count. Go's time.Time has no such value and bson.DateTime is a plain
	// int64, so there is no faithful equivalent to silently produce; this port surfaces an E_QUERY
	// error instead (a deliberate, documented, tested divergence, the same shape as C4's own
	// "invalid number" addition) rather than fabricating an arbitrary timestamp no user asked for.
	"ISODate": func(arg any, hasArg bool, pos int) (any, error) {
		s := jsToString(arg, hasArg)
		t, ok := parseISODate(s)
		if !ok {
			return nil, adapters.New(adapters.CodeQuery,
				fmt.Sprintf("invalid date %q at position %d", s, pos), nil)
		}
		return t, nil
	},
	"Date": func(arg any, hasArg bool, pos int) (any, error) {
		if !hasArg {
			return time.Now().UTC(), nil
		}
		s := jsToString(arg, hasArg)
		t, ok := parseISODate(s)
		if !ok {
			return nil, adapters.New(adapters.CodeQuery,
				fmt.Sprintf("invalid date %q at position %d", s, pos), nil)
		}
		return t, nil
	},
	"NumberLong": func(arg any, hasArg bool, pos int) (any, error) {
		s := jsToString(arg, hasArg)
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return nil, adapters.New(adapters.CodeQuery,
				fmt.Sprintf("invalid NumberLong %q at position %d", s, pos), err)
		}
		return v, nil
	},
	// NumberInt(s): literal.ts's own `Number(arg)` produces a plain JS number, leaving BSON's own
	// width choice to the driver (P58c §1.4/§4.1) — this Go port deliberately narrows it to int32
	// per P58c's own decision table; the acceptance suite asserts only the resulting *value*,
	// never the wire width, so this narrowing is invisible to it.
	"NumberInt": func(arg any, hasArg bool, pos int) (any, error) {
		s := jsToString(arg, hasArg)
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil, adapters.New(adapters.CodeQuery,
				fmt.Sprintf("invalid NumberInt %q at position %d", s, pos), err)
		}
		return int32(f), nil
	},
	"NumberDecimal": func(arg any, hasArg bool, pos int) (any, error) {
		s := jsToString(arg, hasArg)
		d, err := bson.ParseDecimal128(s)
		if err != nil {
			return nil, adapters.New(adapters.CodeQuery,
				fmt.Sprintf("invalid NumberDecimal %q at position %d", s, pos), err)
		}
		return d, nil
	},
}

// --- parser --------------------------------------------------------------------------------

// LiteralParser is the Go analogue of literal.ts's own LiteralParser class. Its exported surface —
// ExpectIdent/ExpectPunct/PeekPunct/ParseValue/AtEnd — is exactly what console.go (M7.3) drives to
// parse the `db.<coll>.<method>(...)` shell-statement grammar on top of this same tokenizer.
type LiteralParser struct {
	tokens []token
	pos    int
}

// NewLiteralParser tokenizes text up front, exactly like literal.ts's own constructor — a
// tokenize error surfaces here, before any parsing begins.
func NewLiteralParser(text string) (*LiteralParser, error) {
	tokens, err := tokenize(text)
	if err != nil {
		return nil, err
	}
	return &LiteralParser{tokens: tokens}, nil
}

func (p *LiteralParser) peekTok() token { return p.tokens[p.pos] }

func (p *LiteralParser) nextTok() token {
	t := p.tokens[p.pos]
	p.pos++
	return t
}

// AtEnd reports whether the parser has consumed every token but the trailing EOF marker.
func (p *LiteralParser) AtEnd() bool { return p.peekTok().typ == tokEOF }

// PeekPunct reports whether the next token is the punctuation character value, without consuming
// it.
func (p *LiteralParser) PeekPunct(value string) bool {
	t := p.peekTok()
	return t.typ == tokPunct && t.value == value
}

// ExpectPunct consumes the next token, requiring it to be the punctuation character value.
func (p *LiteralParser) ExpectPunct(value string) error {
	t := p.nextTok()
	if t.typ != tokPunct || t.value != value {
		return adapters.New(adapters.CodeQuery,
			fmt.Sprintf(`expected "%s" at position %d`, value, t.pos), nil)
	}
	return nil
}

// ExpectIdent consumes the next token, requiring it to be an identifier. An empty expected means
// "any identifier" (literal.ts's own optional parameter); a non-empty expected requires an exact
// match.
func (p *LiteralParser) ExpectIdent(expected string) (string, error) {
	t := p.nextTok()
	if t.typ != tokIdent || (expected != "" && t.value != expected) {
		return "", adapters.New(adapters.CodeQuery,
			fmt.Sprintf(`expected identifier "%s" at position %d`, expected, t.pos), nil)
	}
	return t.value, nil
}

// ParseValue parses one value: an object becomes a bson.D (never a bson.M — C2's key-order
// requirement applies to parsed values too, since a parsed filter's key order is visible in
// op.SetCommand's rendered text), an array a bson.A, a string a string, a number a float64 (C5 —
// literal.ts:161 is `Number(t.value)`, a JS double, not an int64), a boolean a bool, and null/
// undefined a nil `any`.
func (p *LiteralParser) ParseValue() (any, error) {
	t := p.peekTok()
	switch {
	case t.typ == tokPunct && t.value == "{":
		return p.parseObject()
	case t.typ == tokPunct && t.value == "[":
		return p.parseArray()
	case t.typ == tokString:
		p.nextTok()
		return t.value, nil
	case t.typ == tokNumber:
		p.nextTok()
		f, err := strconv.ParseFloat(t.value, 64)
		if err != nil {
			// literal.ts's Number("1.2.3") is NaN, silently. This Go port rejects it instead
			// (P58c C4's one deliberate new message) rather than encoding a double NaN nobody
			// asked for.
			return nil, adapters.New(adapters.CodeQuery,
				fmt.Sprintf(`invalid number "%s" at position %d`, t.value, t.pos), nil)
		}
		return f, nil
	case t.typ == tokIdent:
		switch t.value {
		case "true":
			p.nextTok()
			return true, nil
		case "false":
			p.nextTok()
			return false, nil
		case "null", "undefined":
			p.nextTok()
			return nil, nil
		}
		// The lookahead (literal.ts:177) is what makes a bare `ObjectId` with no call parentheses
		// fall through to the same "unrecognized identifier" rejection as any other bare word.
		if ctor, ok := constructors[t.value]; ok && p.pos+1 < len(p.tokens) && p.tokens[p.pos+1].typ == tokPunct && p.tokens[p.pos+1].value == "(" {
			p.nextTok()
			if err := p.ExpectPunct("("); err != nil {
				return nil, err
			}
			var arg any
			var hasArg bool
			if !p.PeekPunct(")") {
				v, err := p.ParseValue()
				if err != nil {
					return nil, err
				}
				arg, hasArg = v, true
			}
			if err := p.ExpectPunct(")"); err != nil {
				return nil, err
			}
			return ctor(arg, hasArg, t.pos)
		}
		return nil, adapters.New(adapters.CodeQuery,
			fmt.Sprintf(`unrecognized identifier "%s" at position %d`, t.value, t.pos), nil)
	}
	return nil, adapters.New(adapters.CodeQuery,
		fmt.Sprintf("unexpected token at position %d", t.pos), nil)
}

// parseKey accepts a string or a bare identifier — never a number, which is why `{ 1: "x" }` is
// rejected (literal.ts's own parseKey).
func (p *LiteralParser) parseKey() (string, error) {
	t := p.nextTok()
	if t.typ == tokString || t.typ == tokIdent {
		return t.value, nil
	}
	return "", adapters.New(adapters.CodeQuery,
		fmt.Sprintf("expected an object key at position %d", t.pos), nil)
}

// parseObject and parseArray both allow one trailing comma and both terminate on it
// (literal.ts:210-220/:233-243).
func (p *LiteralParser) parseObject() (bson.D, error) {
	if err := p.ExpectPunct("{"); err != nil {
		return nil, err
	}
	obj := bson.D{}
	if p.PeekPunct("}") {
		p.nextTok()
		return obj, nil
	}
	for {
		key, err := p.parseKey()
		if err != nil {
			return nil, err
		}
		if err := p.ExpectPunct(":"); err != nil {
			return nil, err
		}
		val, err := p.ParseValue()
		if err != nil {
			return nil, err
		}
		obj = append(obj, bson.E{Key: key, Value: val})
		if p.PeekPunct(",") {
			p.nextTok()
			if p.PeekPunct("}") {
				p.nextTok()
				break
			}
			continue
		}
		if err := p.ExpectPunct("}"); err != nil {
			return nil, err
		}
		break
	}
	return obj, nil
}

func (p *LiteralParser) parseArray() (bson.A, error) {
	if err := p.ExpectPunct("["); err != nil {
		return nil, err
	}
	arr := bson.A{}
	if p.PeekPunct("]") {
		p.nextTok()
		return arr, nil
	}
	for {
		val, err := p.ParseValue()
		if err != nil {
			return nil, err
		}
		arr = append(arr, val)
		if p.PeekPunct(",") {
			p.nextTok()
			if p.PeekPunct("]") {
				p.nextTok()
				break
			}
			continue
		}
		if err := p.ExpectPunct("]"); err != nil {
			return nil, err
		}
		break
	}
	return arr, nil
}

// ParseJSON5Literal parses text as exactly one value, rejecting trailing content.
func ParseJSON5Literal(text string) (any, error) {
	parser, err := NewLiteralParser(text)
	if err != nil {
		return nil, err
	}
	value, err := parser.ParseValue()
	if err != nil {
		return nil, err
	}
	if !parser.AtEnd() {
		return nil, adapters.New(adapters.CodeQuery, "unexpected trailing content after literal", nil)
	}
	return value, nil
}

// --- EJSON wrapper resolution ----------------------------------------------------------------

// The thirteen wrapper keys EJSON v2 defines, verbatim (literal.ts:259-273). A plain object
// matching one of these shapes is a BSON value spelled as extended JSON rather than a shell
// constructor call — `ObjectId(...)` is already resolved to a real bson.ObjectID by the
// constructor table above, at parse time; `{"$oid": "..."}` is not.
var ejsonWrapperKeys = map[string]struct{}{
	"$oid":               {},
	"$date":              {},
	"$numberInt":         {},
	"$numberLong":        {},
	"$numberDouble":      {},
	"$numberDecimal":     {},
	"$binary":            {},
	"$timestamp":         {},
	"$regularExpression": {},
	"$code":              {},
	"$ref":               {},
	"$minKey":            {},
	"$maxKey":            {},
}

func looksLikeEJSONWrapper(d bson.D) bool {
	if len(d) == 0 {
		return false
	}
	for _, e := range d {
		if _, ok := ejsonWrapperKeys[e.Key]; ok {
			return true
		}
	}
	return false
}

// tryResolveEJSONWrapper is literal.ts's `EJSON.parse(JSON.stringify(value))` (literal.ts:306):
// json.Marshal renders the wrapper subtree as plain JSON text (bson.D/bson.A both carry their own
// MarshalJSON, so this recurses correctly through nested wrappers), then bson.UnmarshalExtJSON
// decodes it into the real BSON value the wrapper denotes.
//
// The wrapper is wrapped in a one-field document ({"v": <wrapper>}) before marshalling, exactly
// like IDText's own MarshalExtJSON direction (P58c M7.0/MG-2 findings, AGENTS.md): the extJSON
// reader only special-cases a `$oid`/`$date`/… shape when it appears as a *field's* value inside a
// document, not at the very top level being decoded directly into a scalar — a top-level `{"$oid":
// "..."}` decodes as an ordinary two-key-lookalike document, silently failing to resolve, which is
// exactly backwards from what this function exists to do.
func tryResolveEJSONWrapper(d bson.D) (any, bool) {
	data, err := json.Marshal(bson.D{{Key: "v", Value: d}})
	if err != nil {
		return nil, false
	}
	var out bson.D
	if err := bson.UnmarshalExtJSON(data, false, &out); err != nil {
		return nil, false
	}
	if len(out) != 1 {
		return nil, false
	}
	return out[0].Value, true
}

// ResolveEJSONWrappers recursively replaces every extended-JSON wrapper object ({$oid}, {$date},
// {$numberLong}, {$binary}, …) with the BSON value it denotes. Leaves every other value alone —
// including an already-resolved BSON instance (bson.ObjectID, time.Time, int64, bson.Decimal128):
// those simply never match the bson.D/bson.A cases below, so they fall through the default case
// untouched, which is Go's structural equivalent of literal.ts's own explicit
// isResolvedBsonInstance check (literal.ts:285-292) — walking a resolved instance's own fields
// would be wrong.
func ResolveEJSONWrappers(value any) any {
	switch v := value.(type) {
	case bson.A:
		out := make(bson.A, len(v))
		for i, item := range v {
			out[i] = ResolveEJSONWrappers(item)
		}
		return out
	case bson.D:
		if looksLikeEJSONWrapper(v) {
			if resolved, ok := tryResolveEJSONWrapper(v); ok {
				return resolved
			}
			// The shape matched but the value didn't (e.g. `{ $oid: 123 }`) — fall through and
			// treat it as a plain object; Mongo will reject a meaningless filter with its own
			// error (literal.ts:307-310's own swallow-and-fall-through, C4).
		}
		out := make(bson.D, len(v))
		for i, e := range v {
			out[i] = bson.E{Key: e.Key, Value: ResolveEJSONWrappers(e.Value)}
		}
		return out
	default:
		return value
	}
}

func parseLiteralObject(text, errMessage string) (bson.D, error) {
	parsed, err := ParseJSON5Literal(text)
	if err != nil {
		return nil, err
	}
	resolved := ResolveEJSONWrappers(parsed)
	d, ok := resolved.(bson.D)
	if !ok {
		return nil, adapters.New(adapters.CodeQuery, errMessage, nil)
	}
	return d, nil
}

// ParseDocumentLiteral is the one grammar every Mongo text surface in the app parses with: shell
// constructors *and* extended JSON, in the same document. Used by ParseFilterObject and by
// mutate.go (M7.3).
func ParseDocumentLiteral(text string) (bson.D, error) {
	return parseLiteralObject(text, "document must be a JSON object")
}

// ParseFilterObject is ParseDocumentLiteral's nil/blank-tolerant sibling for filter text
// specifically: a nil or all-whitespace text is an empty filter, not an error.
func ParseFilterObject(text *string) (bson.D, error) {
	if text == nil || strings.TrimSpace(*text) == "" {
		return bson.D{}, nil
	}
	return parseLiteralObject(*text, `filter must be a JSON object literal, e.g. { field: "value" }`)
}
