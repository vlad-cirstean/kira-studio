package gitsearch

import "strings"

// Field mirrors the wire's SearchMatchField exactly — the seven commit-side members of git-core's
// own nine-member SearchField (no refName, no tagAnnotation: those are the ref scope, resolved
// entirely client-side and never reaching this package).
type Field string

const (
	FieldSubject        Field = "subject"
	FieldBody           Field = "body"
	FieldAuthorName     Field = "authorName"
	FieldAuthorEmail    Field = "authorEmail"
	FieldCommitterName  Field = "committerName"
	FieldCommitterEmail Field = "committerEmail"
	FieldSHA            Field = "sha"
)

// CommitFields is every field a commit can be searched on — the Go twin of git-core's own
// CommitFields. Body is "" for a record the loaded store's own client-side scan could ever
// produce (it holds no commit bodies at all); only this package's own tail scan ever supplies a
// real one, from ScanRecord.Body.
type CommitFields struct {
	SHA            string
	Subject        string
	Body           string
	AuthorName     string
	AuthorEmail    string
	CommitterName  string
	CommitterEmail string
}

// MatchFields is a field-for-field port of matchCommitFields — a straight OR over seven tests, the
// AND-across-categories semantics `git log --grep --author` would give being exactly what
// upstream probe 1 rules out. Returns every field that matched, not a boolean.
//
// The ORDER of the returned slice is a contract: matcher.test.ts's own TOGGLE_ROWS (and this
// package's conformance_test.go, reading the same corpus) assert exact arrays — subject, body,
// authorName, authorEmail, committerName, committerEmail, sha, matcher.ts's own order.
//
// The empty-body guard is ported deliberately: a pattern matching the empty string reports
// subject and not body on a body-less commit (an empty needle can never reach here at all — see
// Matcher's own "empty" doc comment — but a regex-mode pattern that happens to match "" one, e.g.
// `x*`, still must not report a spurious body hit on every commit).
func (m *Matcher) MatchFields(f CommitFields) []Field {
	var hits []Field
	if m.matchText(f.Subject) {
		hits = append(hits, FieldSubject)
	}
	if f.Body != "" && m.matchText(f.Body) {
		hits = append(hits, FieldBody)
	}
	if m.matchText(f.AuthorName) {
		hits = append(hits, FieldAuthorName)
	}
	if m.matchText(f.AuthorEmail) {
		hits = append(hits, FieldAuthorEmail)
	}
	if m.matchText(f.CommitterName) {
		hits = append(hits, FieldCommitterName)
	}
	if m.matchText(f.CommitterEmail) {
		hits = append(hits, FieldCommitterEmail)
	}
	if m.shaPrefix != "" && strings.HasPrefix(strings.ToLower(f.SHA), m.shaPrefix) {
		hits = append(hits, FieldSHA)
	}
	return hits
}
