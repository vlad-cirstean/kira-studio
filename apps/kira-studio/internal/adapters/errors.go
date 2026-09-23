package adapters

import (
	"context"
	"errors"
	"net"
	"regexp"
	"strings"
	"syscall"
	"unicode"
)

// ErrorCode is the Go analogue of errors.ts's AdapterErrorCode — a closed set, verbatim from
// errors.ts:4-12 (P58a A5). Nothing is ever added here without a matching renderer change:
// apps/kira-studio/frontend/src/views/shared/viewOp.ts and state/tabs.ts both branch on these exact strings, and a
// renamed or added code silently stops matching there.
type ErrorCode string

const (
	CodeConnect     ErrorCode = "E_CONNECT"
	CodeAuth        ErrorCode = "E_AUTH"
	CodeCancelled   ErrorCode = "E_CANCELLED"
	CodeTimeout     ErrorCode = "E_TIMEOUT"
	CodeNotFound    ErrorCode = "E_NOT_FOUND"
	CodeQuery       ErrorCode = "E_QUERY"
	CodeUnsupported ErrorCode = "E_UNSUPPORTED"
	CodeEngineDown  ErrorCode = "E_ENGINE_DOWN"
)

// Error is the Go analogue of errors.ts's AdapterError (named Error, not AdapterError, per A1 —
// adapters.AdapterError would stutter at every call site). Message is the server's own message
// verbatim (Adapter rule 4); wrapping starts and ends here.
type Error struct {
	Code    ErrorCode
	Message string
	Cause   error
}

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return e.Cause }

// New constructs an *Error. cause may be nil.
func New(code ErrorCode, message string, cause error) *Error {
	return &Error{Code: code, Message: message, Cause: cause}
}

// CodeOf reports the ErrorCode of err via errors.As, for the dispatcher and the router to branch
// on without importing this package's concrete type everywhere.
func CodeOf(err error) (ErrorCode, bool) {
	var ae *Error
	if errors.As(err, &ae) {
		return ae.Code, true
	}
	return "", false
}

// The seven helpers below port errors.ts's own, messages byte-identical (A6).

// Unsupported is errors.ts's unsupported(kind, what) — P39 F18's shared capability-stub message.
func Unsupported(kind, what string) error {
	return New(CodeUnsupported, what+" is not supported for "+kind, nil)
}

// NoQueryConsole is errors.ts's noQueryConsole(kind).
func NoQueryConsole(kind string) error {
	return New(CodeUnsupported, kind+" has no query console", nil)
}

// AssertWritable is errors.ts's assertWritable(readOnly) — P39 iter2 F15's shared read-only guard.
func AssertWritable(readOnly bool) error {
	if readOnly {
		return New(CodeUnsupported, "connection is read-only", nil)
	}
	return nil
}

var (
	sqlReadWrite = regexp.MustCompile(`(?i)READ\s+WRITE`)
	// sqlReadOnlyVarOff catches a statement that names any of the three read-only-mode GUCs/session
	// variables the postgres and mysqlfamily adapters rely on (default_transaction_read_only /
	// transaction_read_only on postgres and mysql, tx_read_only on mariadb) and assigns it a falsy
	// value — the non-SQL-standard way to ask for the same escalation "READ WRITE" asks for by
	// phrase (review finding: `SET transaction_read_only = off` inside the wrapping transaction
	// confirmed, against a real Postgres server, to flip that transaction writable and let a
	// following DELETE succeed, with no "READ WRITE" phrase anywhere in the statement for
	// sqlReadWrite to catch).
	sqlReadOnlyVarOff = regexp.MustCompile(`(?i)\b(?:default_transaction_read_only|transaction_read_only|tx_read_only)\b\s*(?:=|TO)\s*'?(?:off|false|0)\b`)
)

// endsTransaction reports whether stmt (already comment-stripped) is a bare statement that ends
// the current transaction — COMMIT, END (postgres's alias for COMMIT), or ROLLBACK — rather than
// a statement that merely mentions one of those words. A real read-only console session has no
// legitimate reason to end its own wrapping transaction mid-batch (postgres/mysqlfamily console.go
// both wrap the whole Execute() batch in one read-only transaction specifically so no statement in
// it can run outside that transaction's protection): confirmed against a real server that
// `COMMIT; SET SESSION tx_read_only = OFF; ...` (mariadb) / `SET SESSION transaction_read_only =
// OFF` (mysql) does exactly that — the COMMIT ends the wrapper, and the SET then takes effect
// immediately for the write statement that follows in plain autocommit mode, with neither the
// COMMIT nor the SET containing "READ WRITE" for sqlReadWrite to catch (postgres itself is not
// vulnerable to this particular sequence — confirmed empirically that transaction_read_only set
// outside an explicit transaction does not carry over to the next implicit one there — but nothing
// about a read-only console session ever legitimately needs its own COMMIT/END/ROLLBACK either, so
// this is rejected unconditionally rather than only where a bypass happens to have been proven).
// ROLLBACK TO SAVEPOINT is exempted: it only rewinds to a savepoint, never ends the transaction.
func endsTransaction(stmt string) bool {
	trimmed := strings.TrimSuffix(strings.TrimSpace(stmt), ";")
	fields := strings.Fields(trimmed)
	if len(fields) == 0 {
		return false
	}
	switch strings.ToUpper(fields[0]) {
	case "COMMIT", "END":
		return true
	case "ROLLBACK":
		for _, f := range fields[1:] {
			if strings.EqualFold(f, "TO") {
				return false
			}
		}
		return true
	default:
		return false
	}
}

// scanQuote reports the end index (exclusive) of a quoted run opened by r[i] (one of `'`, `"`,
// “ ` “) — the same doubled-quote escaping rule every dialect here honours (`”`, `""`, “ “ “
// repeats the quote character as content rather than closing). Runs to len(r) — the caller's own
// EOF — when unterminated, never past it.
//
// Backslash is deliberately never treated as an escape here, with one exception (escapeBackslash),
// unlike sql-lex.ts's own default (packages/shared/domain/sql-lex.ts): this scanner backs every SQL
// dialect this app supports without knowing which one is live, and Postgres's own
// standard-conforming strings (the default since 9.1) do not honour a backslash escape at all.
// Assuming one unconditionally would extend a quoted span past where a standard-conforming Postgres
// string actually ends it, hiding a real statement separator inside what this scanner would wrongly
// still consider a string.
//
// escapeBackslash is true only for a Postgres E'...'/e'...' string (isEStringOpen, checked by the
// caller): Postgres treats backslash as an escape inside an E-string unconditionally, regardless of
// standard_conforming_strings, so this one case is safe to special-case rather than guess. Without
// it (finding F1, HIGH/security): `E'\' -- '` — a real Postgres string whose content is `\` followed
// by ` -- ` — was read as ending right after the backslash-escaped quote, with the genuine closing
// quote and everything after it (a real `;` and a smuggled second statement) left to be swallowed by
// what then looked like a `--` line comment starting right after the falsely-closed string,
// bypassing both ClassifySQL and AssertNoTransactionEscalation. Every other quoted run (plain `'...'`
// strings when standard_conforming_strings is off at runtime — unknowable here — MySQL/MariaDB's own
// default backslash escaping, double-quoted identifiers, backtick identifiers) still treats
// backslash as ordinary content: AssertNoTransactionEscalation's own quoteHasBackslash is the
// fail-closed backstop for exactly those cases this scanner cannot resolve on its own.
func scanQuote(r []rune, i int, escapeBackslash bool) int {
	quote := r[i]
	j := i + 1
	for j < len(r) {
		if escapeBackslash && r[j] == '\\' {
			j += 2
			continue
		}
		if r[j] == quote {
			if j+1 < len(r) && r[j+1] == quote {
				j += 2
				continue
			}
			return j + 1
		}
		j++
	}
	return j
}

// isEStringOpen reports whether the quote at r[i] opens a Postgres E'...'/e'...' string — the one
// case backslash unconditionally escapes regardless of standard_conforming_strings (finding F1).
// Requires r[i] == '\'' and the immediately preceding rune to be a standalone E/e: a word boundary
// before it (or start of input), so an identifier merely ending in e/E (`table`, `value`) is never
// mistaken for the prefix.
func isEStringOpen(r []rune, i int) bool {
	if r[i] != '\'' || i == 0 {
		return false
	}
	prev := r[i-1]
	if prev != 'E' && prev != 'e' {
		return false
	}
	if i-2 >= 0 && isSQLIdentRune(r[i-2]) {
		return false
	}
	return true
}

func isSQLIdentRune(r rune) bool {
	return r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r)
}

// scanDollarQuote reports the end index (exclusive) of a Postgres dollar-quoted string opened by
// r[i] == '$' (`$$...$$` or `$tag$...$tag$`, mirroring sql-lex.ts's own regexp), or -1 when r[i]
// doesn't actually open one — a bare `$` used as an ordinary character (a `$1` placeholder, a
// MySQL identifier) rather than a quote.
func scanDollarQuote(r []rune, i int) int {
	n := len(r)
	j := i + 1
	if j < n && (unicode.IsLetter(r[j]) || r[j] == '_') {
		j++
		for j < n && (unicode.IsLetter(r[j]) || unicode.IsDigit(r[j]) || r[j] == '_') {
			j++
		}
	}
	if j >= n || r[j] != '$' {
		return -1
	}
	tagEnd := j + 1
	tag := r[i:tagEnd]
	for k := tagEnd; k+len(tag) <= n; k++ {
		if runesEqual(r[k:k+len(tag)], tag) {
			return k + len(tag)
		}
	}
	return n
}

func runesEqual(a, b []rune) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// StripSQLComments replaces every SQL comment — a line comment (`--` to end of line) or a block
// comment (`/* ... */`) — with a single space, preserving token boundaries the same way real SQL
// treats a comment as lexical whitespace (confirmed against a real server: `READ/*x*/WRITE` parses
// identically to `READ WRITE`, so a comment must become a space, never be deleted outright, or the
// two keywords it separated would glue together and slip past sqlReadWrite's \s+). Block comments
// nest on both postgres and mysql/mariadb — confirmed against a real Postgres server that `READ
// /* /* */ x */ WRITE` parses identically to `READ WRITE`, i.e. the outer /* runs all the way to
// its own matching, correctly-nested */, swallowing the inner comment and the "x" between them —
// which a single non-nesting regexp pass cannot express, so this scans by rune and tracks depth
// instead.
//
// Quote-aware (finding #1, M6): a `'`, `"`, “ ` “ or Postgres dollar-quote opened outside any
// comment is skipped over as one atomic run before comment markers are even considered inside it,
// so `--`/`/*` appearing inside a string literal — e.g. `SELECT '/*' ; DROP TABLE users` — is never
// mistaken for a real comment start. Before this, such a marker inside a quote was read as a
// genuine (often unterminated) comment, silently swallowing everything after it, including the
// real `;` that should have tripped ClassifySQL's embedded-statement guard — a permission-gate
// bypass, not just a cosmetic parse difference.
//
// MySQL/MariaDB "executable comment" aware (finding #2, M7): `/*! ... */` (and MariaDB's own
// `/*M! ... */`), optionally followed by a version-gate number (`/*!50000 ... */`), is not an
// ordinary comment on those two dialects — the server strips only the marker and the closing `*/`
// and runs the body between them as real SQL. Confirmed against a real MariaDB server: `/*!COMMIT*/
// /*!SET SESSION tx_read_only = OFF*/ DELETE FROM users` executes all three statements, though the
// body of each looks exactly like an ordinary block comment to a naive scanner. Before this fix,
// StripSQLComments discarded the body along with the marker, so AssertNoTransactionEscalation saw
// none of the smuggled COMMIT/SET and ClassifySQL never saw the smuggled `INTO OUTFILE` either —
// both a read-only-escalation and an MCP write-gate bypass. This scanner has no dialect argument
// (see the package doc note on ClassifySQL for why: one shared classifier serves five dialects with
// no per-dialect parser), so the marker is always treated as non-comment, the safe direction: on a
// dialect without this syntax (Postgres/SQLite/ClickHouse), a real comment that happens to start
// with `/*!` or `/*M!` stays visible as literal text instead of being stripped, which can only turn
// a would-be ClassRead into a false ClassUnknown — never hide a write behind what looked like a
// stripped comment.
//
// Nesting itself is only confirmed for two of the five dialects (M7 finding #13): the paragraph
// above verified Postgres and MySQL/MariaDB against a real server; SQLite and ClickHouse follow the
// C89 convention instead, where the *first* `*/` ends the comment regardless of an inner `/*` — one
// shared scanner with no dialect argument (same reason execCommentMarkerLen's own default applies
// unconditionally) means SQLite/ClickHouse get treated as nesting too. That is still the safe
// direction, not merely an untested one: treating a non-nesting dialect as if it nested can only
// over-strip (swallow more of the statement as "comment" than that server actually would), and an
// over-stripped statement heads toward ClassUnknown (an empty or truncated leading-keyword scan) or
// a false read, never a hidden write — the one property ClassifySQL's callers actually depend on.
// A `/* /* */ DROP ... */` sequence that this scanner reads as one nested comment would, on the
// real non-nesting server, instead end at the first `*/`, leaving a dangling `*/` afterward that is
// itself a syntax error on every dialect checked — so the divergence has no known statement shape
// that both parses on the real server and smuggles a different classification through this
// scanner. AssertNoTransactionEscalation's and ClassifySQL's own embedded-semicolon guard is the
// actual backstop for a genuine multi-statement payload regardless: neither depends on comment
// nesting being dialect-correct, only on a `;` inside a comment/string never being mistaken for one
// outside it, which quote-awareness (above) and this scanner's char-by-char scan both already give
// unconditionally.
func StripSQLComments(s string) string {
	r := []rune(s)
	var out strings.Builder
	st := commentScanState{}
	for i := 0; i < len(r); {
		switch {
		case st.depth == 0 && isQuoteStart(r[i]):
			next, chunk := scanQuoteArm(r, i)
			out.WriteString(chunk)
			i = next
		case st.depth == 0 && r[i] == '$':
			next, chunk := scanDollarArm(r, i)
			out.WriteString(chunk)
			i = next
		case st.depth == 0 && startsLineComment(r, i):
			next, chunk := scanLineCommentArm(r, i)
			out.WriteString(chunk)
			i = next
		case st.execComment && st.depth == 0 && startsBlockCommentClose(r, i):
			next, chunk := scanExecCommentCloseArm(i)
			out.WriteString(chunk)
			i = next
			st.execComment = false
		case startsBlockCommentOpen(r, i):
			next, chunk, next2 := scanBlockCommentOpenArm(r, i, st)
			out.WriteString(chunk)
			i = next
			st = next2
		case st.depth > 0 && startsBlockCommentClose(r, i):
			next, chunk, newDepth := scanBlockCommentCloseArm(i, st.depth)
			out.WriteString(chunk)
			i = next
			st.depth = newDepth
		case st.depth > 0:
			i++
		default:
			out.WriteRune(r[i])
			i++
		}
	}
	return out.String()
}

// commentScanState is StripSQLComments's threaded state: block-comment nesting depth and whether
// the scanner is inside a MySQL/MariaDB executable comment (`/*! ... */`).
type commentScanState struct {
	depth       int
	execComment bool
}

func isQuoteStart(c rune) bool { return c == '\'' || c == '"' || c == '`' }

func startsLineComment(r []rune, i int) bool {
	return r[i] == '-' && i+1 < len(r) && r[i+1] == '-'
}

func startsBlockCommentOpen(r []rune, i int) bool {
	return r[i] == '/' && i+1 < len(r) && r[i+1] == '*'
}

func startsBlockCommentClose(r []rune, i int) bool {
	return r[i] == '*' && i+1 < len(r) && r[i+1] == '/'
}

// scanQuoteArm handles a quoted run opened at r[i] — StripSQLComments's quote-aware pass-through.
func scanQuoteArm(r []rune, i int) (next int, chunk string) {
	end := scanQuote(r, i, isEStringOpen(r, i))
	return end, string(r[i:end])
}

// scanDollarArm handles a `$` at r[i]: a Postgres dollar-quoted string, or an ordinary `$` when it
// doesn't open one.
func scanDollarArm(r []rune, i int) (next int, chunk string) {
	if end := scanDollarQuote(r, i); end >= 0 {
		return end, string(r[i:end])
	}
	return i + 1, string(r[i])
}

// scanLineCommentArm consumes a `--` line comment to end of line, replaced by a single space.
func scanLineCommentArm(r []rune, i int) (next int, chunk string) {
	j := i
	for j < len(r) && r[j] != '\n' {
		j++
	}
	return j, " "
}

// scanExecCommentCloseArm closes an open MySQL/MariaDB executable comment at r[i] ("*/").
func scanExecCommentCloseArm(i int) (next int, chunk string) {
	return i + 2, " "
}

// scanBlockCommentOpenArm handles "/*" at r[i]: either the start of a MySQL/MariaDB executable
// comment (only recognised at depth 0, outside any other exec comment), or an ordinary block
// comment open, which increments nesting depth at any depth.
func scanBlockCommentOpenArm(r []rune, i int, st commentScanState) (next int, chunk string, out commentScanState) {
	if st.depth == 0 && !st.execComment {
		if markerLen := execCommentMarkerLen(r, i); markerLen > 0 {
			return i + markerLen, " ", commentScanState{depth: st.depth, execComment: true}
		}
	}
	return i + 2, "", commentScanState{depth: st.depth + 1, execComment: st.execComment}
}

// scanBlockCommentCloseArm handles "*/" at r[i] while inside a nested block comment (depth > 0).
func scanBlockCommentCloseArm(i int, depth int) (next int, chunk string, newDepth int) {
	newDepth = depth - 1
	if newDepth == 0 {
		return i + 2, " ", newDepth
	}
	return i + 2, "", newDepth
}

// execCommentMarkerLen reports the rune length of a MySQL/MariaDB executable-comment opening
// marker at r[i] — `/*!`, `/*M!`/`/*m!`, each optionally followed by a run of digits (the
// version-gate number) — or 0 when r[i:] does not open one. Digits are consumed as part of the
// marker (not SQL body): they gate which server version runs the body, they are never themselves
// part of the statement.
func execCommentMarkerLen(r []rune, i int) int {
	n := len(r)
	j := i + 2 // past "/*"
	switch {
	case j < n && r[j] == '!':
		j++
	case j+1 < n && (r[j] == 'M' || r[j] == 'm') && r[j+1] == '!':
		j += 2
	default:
		return 0
	}
	for j < n && r[j] >= '0' && r[j] <= '9' {
		j++
	}
	return j - i
}

// AssertNoTransactionEscalation is a console-Execute-only backstop for postgres/mysqlfamily (P2
// R2, hardened per a later review round): both enforce a read-only connection by setting a
// *session default* (default_transaction_read_only / SESSION TRANSACTION READ ONLY) at connect
// time and wrapping each Execute() batch in an explicit read-only transaction, neither of which a
// statement inside that same transaction can be trusted not to try to escape. Three angles are
// rejected outright rather than run, each confirmed against a real server (see StripSQLComments,
// sqlReadOnlyVarOff and endsTransaction's own doc comments for what was actually tried and what a
// real server actually did): the SQL-standard `READ WRITE` phrase, naming a read-only GUC/session
// variable and assigning it a falsy value, and a bare COMMIT/END/ROLLBACK that would end the
// wrapping transaction itself. This function cannot be made complete against every possible
// escalation a SQL dialect can express — it is a backstop on top of the real enforcement (the
// session default plus the wrapping transaction), not a substitute for it.
func AssertNoTransactionEscalation(statements []string) error {
	for _, stmt := range statements {
		if err := AssertNoHiddenStatement(stmt); err != nil {
			return err
		}
		stripped := StripSQLComments(stmt)
		if sqlReadWrite.MatchString(stripped) || sqlReadOnlyVarOff.MatchString(stripped) || endsTransaction(stripped) {
			return New(CodeUnsupported, "connection is read-only", nil)
		}
	}
	return nil
}

// AssertNoHiddenStatement is F1's fail-closed backstop for a read-only Postgres connection, over
// any raw SQL fragment this app treats as one unit without ever fully parsing it: a console
// statement (via AssertNoTransactionEscalation above), or a grid filter / text-sort clause
// concatenated straight into a WHERE/ORDER BY and run over pgx's simple protocol with no wrapping
// transaction or classification of its own — the second, lower-weight path finding F1 names.
// Postgres's simple protocol executes every statement found in a string it is handed, so either
// input hiding a second top-level statement must be rejected outright rather than let the extra
// statement run:
//
//   - quoteHasBackslash: a quoted run containing a backslash. scanQuote only special-cases a
//     Postgres E'...'/e'...' string; an ordinary '...' string honours a backslash escape too
//     whenever standard_conforming_strings is off at runtime, which nothing at parse time can
//     detect, so this scanner's own idea of where such a quote ends cannot be trusted — treated as
//     a reject, not a guess.
//   - a `;` that survives in the comment-stripped text after exactly one legitimate trailing
//     semicolon is removed — a hidden second statement a naive split missed.
func AssertNoHiddenStatement(s string) error {
	if quoteHasBackslash(s) {
		return New(CodeUnsupported, "connection is read-only", nil)
	}
	stripped := strings.TrimSpace(StripOneTrailingSemicolon(strings.TrimSpace(StripSQLComments(s))))
	if strings.Contains(stripped, ";") {
		return New(CodeUnsupported, "connection is read-only", nil)
	}
	return nil
}

// quoteHasBackslash reports whether any quoted run in s (as scanQuote's own doubled-quote
// convention delimits it, backslash never treated as an escape here — the ordinary, conservative
// reading) contains a raw backslash. A Postgres dollar-quoted run is skipped over (never itself
// ambiguous — its terminator is its own repeated `$tag$`, not a quote character a backslash could
// interact with) so it is never mistaken for one.
func quoteHasBackslash(s string) bool {
	r := []rune(s)
	for i := 0; i < len(r); {
		switch {
		case isQuoteStart(r[i]):
			end := scanQuote(r, i, false)
			if strings.ContainsRune(string(r[i:end]), '\\') {
				return true
			}
			i = end
		case r[i] == '$':
			if end := scanDollarQuote(r, i); end >= 0 {
				i = end
				continue
			}
			i++
		default:
			i++
		}
	}
	return false
}

// CheckNotStarted is errors.ts's assertNotCancelled(ctx) — Adapter rule 2's pre-flight check,
// reporting a cancel that landed before the call started. Distinct message from CheckCancelled
// (A6): the two report genuinely different moments.
func CheckNotStarted(ctx context.Context) error {
	if ctx.Err() != nil {
		return New(CodeCancelled, "operation was cancelled before it started", ctx.Err())
	}
	return nil
}

// CheckCancelled is errors.ts's throwIfCancelled(ctx) — the mid-flight sibling, re-run after an
// await, not before starting.
func CheckCancelled(ctx context.Context) error {
	if ctx.Err() != nil {
		return New(CodeCancelled, "operation was cancelled", ctx.Err())
	}
	return nil
}

// RequireConnected is errors.ts's requireConnected(handle) — the "did connect() ever run" guard.
// Go has no null-vs-nil-pointer distinction to worry about here: a nil handle is the same "not
// connected" state a nullish TS handle represents.
func RequireConnected[T any](handle *T) (*T, error) {
	if handle == nil {
		return nil, New(CodeConnect, "adapter is not connected", nil)
	}
	return handle, nil
}

// NetError is ClassifyNetError's result — the independent facts six adapters' own mapError
// functions each re-derived inline (P107 I2-37). A shared detection pass, not a shared decision:
// the six route these facts to different ErrorCodes in different priority order (mysqlfamily and
// postgres treat a timeout as CodeConnect; clickhouse treats it as CodeTimeout; redis matches any
// net.Error unconditionally; kafka and awscfg match *net.OpError with no timeout distinction at
// all), so ClassifyNetError reports facts only and leaves that dispatch to each caller.
type NetError struct {
	DNS        bool
	Refused    bool
	OpError    *net.OpError
	NetTimeout bool
	IsNetError bool
}

// ClassifyNetError runs the errors.As/errors.Is checks every adapter's mapError repeated inline.
func ClassifyNetError(err error) NetError {
	var ne NetError
	var dnsErr *net.DNSError
	ne.DNS = errors.As(err, &dnsErr)
	ne.Refused = errors.Is(err, syscall.ECONNREFUSED)
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		ne.OpError = opErr
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		ne.IsNetError = true
		ne.NetTimeout = netErr.Timeout()
	}
	return ne
}
