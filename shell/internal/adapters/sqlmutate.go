package adapters

import (
	"sort"
	"strings"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// This file is the Go analogue of sql-mutate.ts: the mutation-plan ordering rule and the
// dialect-agnostic renderer four adapters share for UPDATE/DELETE/INSERT text.

var kindRank = map[string]int{"delete": 0, "update": 1, "insert": 2}

// OrderedOps ports sql-mutate.ts's orderedOps: delete, then update, then insert, regardless of the
// plan's own array order — a P5 semantic rule, not a dialect one. sort.SliceStable, not sort.Slice:
// Array.prototype.sort is stable and two ops of the same kind must keep their plan order.
func OrderedOps(ops []model.MutationRowOp) []model.MutationRowOp {
	out := append([]model.MutationRowOp{}, ops...)
	sort.SliceStable(out, func(i, j int) bool {
		return kindRank[out[i].Kind] < kindRank[out[j].Kind]
	})
	return out
}

// AssertColumnsKnown ports sql-mutate.ts's assertColumnsKnown. A generated column is deliberately
// NOT blocked here (P36 D28) — an explicit mutate() call that targets one is left for the server
// to refuse in its own words.
func AssertColumnsKnown(columns []model.ColumnMeta, names []string) error {
	known := make(map[string]struct{}, len(columns))
	for _, c := range columns {
		known[c.Name] = struct{}{}
	}
	for _, name := range names {
		if _, ok := known[name]; !ok {
			return New(CodeNotFound, "unknown column in mutation: "+name, nil)
		}
	}
	return nil
}

// AssertAffectedExactlyOne ports sql-mutate.ts's assertAffectedExactlyOne.
func AssertAffectedExactlyOne(kind string, n int64) error {
	if n != 1 {
		return New(CodeQuery, "expected "+kind+" to affect exactly one row, affected "+itoa(n), nil)
	}
	return nil
}

func itoa(n int64) string {
	// avoids pulling in strconv just for this one call site's formatting need beyond what fmt
	// already does elsewhere in this package; kept trivial on purpose.
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// AssertKeyIsPrimaryKey ports sql-mutate.ts's assertKeyIsPrimaryKey — a partial or missing primary
// key is not a safe row identifier (P5 D1/D2). qualifiedName is the already-built display string
// each adapter spells its own way.
func AssertKeyIsPrimaryKey(primaryKey []string, key model.RowValues, qualifiedName string) error {
	if len(primaryKey) == 0 {
		return New(CodeUnsupported, qualifiedName+" has no primary key", nil)
	}
	given := append([]string{}, key.Names()...)
	sort.Strings(given)
	pk := append([]string{}, primaryKey...)
	sort.Strings(pk)
	if len(given) != len(pk) {
		return New(CodeQuery, "row key must be exactly the primary key columns", nil)
	}
	for i := range given {
		if given[i] != pk[i] {
			return New(CodeQuery, "row key must be exactly the primary key columns", nil)
		}
	}
	return nil
}

// ValueRenderer is the Go analogue of sql-mutate.ts's ValueRenderer<P> — the one thing the three
// SQL dialects disagree on is the placeholder each renderer emits ($n vs ?), which BuildKeysetPredicate
// already takes as a parameter for the same reason.
type ValueRenderer func(value *string, params *[]any) string

// LiteralRenderer is preview()'s renderer (never executes): an escaped SQL literal, no params
// touched.
func LiteralRenderer(value *string) string {
	if value == nil {
		return "NULL"
	}
	return "'" + strings.ReplaceAll(*value, "'", "''") + "'"
}

// NewParamRenderer is mutate()'s renderer — pushes onto params and returns the dialect's
// placeholder for the position it landed at.
func NewParamRenderer(placeholder func(int) string) ValueRenderer {
	return func(value *string, params *[]any) string {
		*params = append(*params, value)
		return placeholder(len(*params))
	}
}

func whereFromKey(key model.RowValues, render ValueRenderer, params *[]any, quote func(string) string) string {
	parts := make([]string, len(key))
	for i, kv := range key {
		if kv.Value == nil {
			parts[i] = quote(kv.Name) + " IS NULL"
		} else {
			parts[i] = quote(kv.Name) + " = " + render(kv.Value, params)
		}
	}
	return strings.Join(parts, " AND ")
}

// RenderRowOp ports sql-mutate.ts's renderRowOp: UPDATE/DELETE/INSERT text for one row op, with
// the WHERE built from the row key. quote is the caller's own quoteIdent.
func RenderRowOp(relationSQL string, op model.MutationRowOp, render ValueRenderer, params *[]any, quote func(string) string) string {
	switch op.Kind {
	case "update":
		setParts := make([]string, len(op.Changes))
		for i, kv := range op.Changes {
			setParts[i] = quote(kv.Name) + " = " + render(kv.Value, params)
		}
		return "UPDATE " + relationSQL + " SET " + strings.Join(setParts, ", ") +
			" WHERE " + whereFromKey(op.Key, render, params, quote)
	case "delete":
		return "DELETE FROM " + relationSQL + " WHERE " + whereFromKey(op.Key, render, params, quote)
	default: // "insert"
		columns := make([]string, len(op.Values))
		values := make([]string, len(op.Values))
		for i, kv := range op.Values {
			columns[i] = quote(kv.Name)
			values[i] = render(kv.Value, params)
		}
		return "INSERT INTO " + relationSQL + " (" + strings.Join(columns, ", ") + ") VALUES (" +
			strings.Join(values, ", ") + ")"
	}
}

// ResolveDatabaseTablePath ports sql-mutate.ts's resolveDatabaseTablePath — the two-segment
// database/table path check clickhouse/mysql-family/sqlite's mutate.ts each wrote out; postgres
// keeps its own three-segment resolveTablePath. Ported here in M1 because P58b's three adapters
// all need it and M1 is the substrate milestone.
func ResolveDatabaseTablePath(path model.NodePath) (database, table string, err error) {
	if len(path.Segments) != 2 || path.Segments[0].Kind != "database" || path.Segments[1].Kind != "table" {
		return "", "", New(CodeNotFound, "mutate requires a database/table path, got: "+model.EncodePath(path.Segments), nil)
	}
	return path.Segments[0].Name, path.Segments[1].Name, nil
}
