package adapters

import (
	"context"
	"strings"
)

// OpClass is what one console statement would do, as the connection's MCP permissions name it
// (M2). A classification is about the statement's declared shape, not its effects: `SELECT
// write_function()` reads as ClassRead. This sits on top of the connection's own ReadOnly flag and
// each adapter's own enforcement (BEGIN READ ONLY, Mongo's per-method check, Redis's COMMAND
// check), never instead of them.
type OpClass string

const (
	ClassRead    OpClass = "read"
	ClassWrite   OpClass = "write"
	ClassDDL     OpClass = "ddl"
	ClassUnknown OpClass = "unknown" // classified by nothing; the caller applies its strictest rule
)

// StatementClassifier is optional adapter surface, deliberately not a method on Adapter: only the
// kinds with a console (Caps().SQL, or Mongo/Redis's own console grammar) can answer it at all,
// and adding a tenth method every adapter must stub would be the "hardcoded kind list" Caps exists
// to prevent, spelled differently.
type StatementClassifier interface {
	ClassifyStatement(ctx context.Context, statement string) (OpClass, error)
}

// sqlWriteKeywords is ClassifySQL's write vocabulary, matched against the statement's leading
// keyword only.
var sqlWriteKeywords = map[string]bool{
	"INSERT": true, "UPDATE": true, "DELETE": true, "MERGE": true, "REPLACE": true,
	"UPSERT": true, "COPY": true, "LOAD": true, "IMPORT": true,
}

// sqlDDLKeywords is ClassifySQL's DDL vocabulary, matched against the statement's leading keyword
// only. TRUNCATE counts as DDL, not write — the SQL standard's own placement.
var sqlDDLKeywords = map[string]bool{
	"CREATE": true, "ALTER": true, "DROP": true, "TRUNCATE": true, "RENAME": true,
	"COMMENT": true, "GRANT": true, "REVOKE": true, "ATTACH": true, "DETACH": true,
	"REINDEX": true, "VACUUM": true, "OPTIMIZE": true, "REFRESH": true, "CLUSTER": true,
	"ANALYZE": true,
}

// sqlReadKeywords is ClassifySQL's plain-read vocabulary, matched against the statement's leading
// keyword only.
var sqlReadKeywords = map[string]bool{
	"SHOW": true, "DESCRIBE": true, "DESC": true, "VALUES": true, "TABLE": true,
}

// sqlWordBoundaryContainsAny reports whether any upper-cased word in s (split on non-word runes)
// is a key of words — used where a keyword can appear anywhere in the statement (WITH bodies,
// SELECT ... INTO), not just leading.
func sqlWordBoundaryContainsAny(s string, words map[string]bool) bool {
	for _, field := range strings.FieldsFunc(s, isSQLWordBoundary) {
		if words[strings.ToUpper(field)] {
			return true
		}
	}
	return false
}

// isSQLWordBoundary splits on anything that is not a letter, digit or underscore — the same
// notion of "word" a regexp \b boundary uses, applied by hand so ClassifySQL needs no additional
// regexp beyond the ones sqlReadWrite already defines in errors.go.
func isSQLWordBoundary(r rune) bool {
	return !(r == '_' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'))
}

// explainAnalyzeTarget inspects the (already comment/semicolon-stripped) text following the
// EXPLAIN keyword and reports whether ANALYZE was requested — either the bare `EXPLAIN ANALYZE
// ...` form or Postgres's parenthesised option-list form, `EXPLAIN (ANALYZE) ...` / `EXPLAIN
// (ANALYZE, BUFFERS) ...` — since either genuinely executes the target statement, unlike a plain
// EXPLAIN (finding #2, M6: the parenthesised form was previously missed entirely, since the token
// right after EXPLAIN there is `(ANALYZE)`/`(ANALYZE,`, never exactly "ANALYZE"). target is what
// remains to classify when hasAnalyze is true. ok is false only when rest opens with `(` but the
// option list never balances — the caller must not default to ClassRead over text it can't parse,
// since an unparseable option list might be hiding ANALYZE inside it.
func explainAnalyzeTarget(rest string) (hasAnalyze bool, target string, ok bool) {
	if strings.HasPrefix(rest, "(") {
		r := []rune(rest)
		depth := 0
		end := -1
		for i, ch := range r {
			switch ch {
			case '(':
				depth++
			case ')':
				depth--
				if depth == 0 {
					end = i
				}
			}
			if end >= 0 {
				break
			}
		}
		if end < 0 {
			return false, "", false
		}
		options := string(r[1:end])
		target = strings.TrimSpace(string(r[end+1:]))
		return sqlWordBoundaryContainsAny(options, map[string]bool{"ANALYZE": true}), target, true
	}
	fields := strings.Fields(rest)
	if len(fields) > 0 && strings.EqualFold(fields[0], "ANALYZE") {
		return true, strings.TrimSpace(rest[len(fields[0]):]), true
	}
	return false, rest, true
}

// ClassifySQL classifies statement by its leading keyword over comment-stripped text. It is
// leading-keyword classification, not a parser — see the package doc note on OpClass for what
// that does and does not guarantee.
//
// No SQL parser is used here, deliberately: this app runs five SQL dialects through one console
// path, and the question asked is one bit wide — what the statement's leading verb is. A
// dialect-bound parser (pg_query_go for Postgres, vitess's sqlparser for MySQL) would add more
// failure surface than it removes, and still answer nothing for ClickHouse.
func ClassifySQL(statement string) OpClass {
	stripped := strings.TrimSpace(StripOneTrailingSemicolon(StripSQLComments(statement)))

	// Embedded-semicolon guard: a leading keyword says nothing about a second statement smuggled
	// behind it, and whether a driver executes both is a per-driver DSN detail this classifier must
	// not depend on. A semicolon inside a string literal costs a false ClassUnknown (a prompt); a
	// missed second statement costs a silent write. Only one of those is acceptable.
	if strings.Contains(stripped, ";") {
		return ClassUnknown
	}

	fields := strings.Fields(stripped)
	if len(fields) == 0 {
		return ClassUnknown
	}
	keyword := strings.ToUpper(fields[0])

	switch {
	case keyword == "SELECT":
		// SELECT ... INTO creates a table on Postgres and writes a file on MySQL.
		if sqlWordBoundaryContainsAny(stripped, map[string]bool{"INTO": true}) {
			return ClassWrite
		}
		return ClassRead
	case keyword == "WITH":
		// Postgres allows a data-modifying CTE, and a DDL statement can follow a CTE, so the whole
		// statement is scanned rather than just the leading keyword.
		if sqlWordBoundaryContainsAny(stripped, sqlDDLKeywords) {
			return ClassDDL
		}
		if sqlWordBoundaryContainsAny(stripped, sqlWriteKeywords) {
			return ClassWrite
		}
		return ClassRead
	case sqlReadKeywords[keyword]:
		return ClassRead
	case keyword == "EXPLAIN":
		rest := strings.TrimSpace(stripped[len(fields[0]):])
		hasAnalyze, target, ok := explainAnalyzeTarget(rest)
		if !ok {
			// A leading parenthesised option list this scanner can't balance might be hiding
			// ANALYZE inside it — never assume ClassRead over an option list it can't parse.
			return ClassUnknown
		}
		if hasAnalyze {
			// EXPLAIN ANALYZE (bare or Postgres's `EXPLAIN (ANALYZE, ...)` form) genuinely runs
			// the statement — classify what follows.
			return ClassifySQL(target)
		}
		return ClassRead
	case sqlWriteKeywords[keyword]:
		return ClassWrite
	case sqlDDLKeywords[keyword]:
		return ClassDDL
	default:
		// PRAGMA, SET, USE, BEGIN, COMMIT, ROLLBACK, CALL, DO, EXEC and an empty statement all land
		// here. PRAGMA is called out because `PRAGMA journal_mode=WAL` writes; SET because a session
		// change is neither a read nor a write in this vocabulary; the transaction verbs because
		// AssertNoTransactionEscalation already rejects them on a read-only connection and they
		// express no data intent here.
		return ClassUnknown
	}
}
