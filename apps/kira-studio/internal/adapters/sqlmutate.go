package adapters

import (
	"encoding/hex"
	"sort"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
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
// already takes as a parameter for the same reason. It also takes the column name (NewParamRenderer's
// own binary-decoding gate below needs it) and can fail: a malformed edited value must be reported,
// not silently mis-encoded.
type ValueRenderer func(name string, value *string, params *[]any) (string, error)

// LiteralRenderer is preview()'s renderer (never executes): an escaped SQL literal, no params
// touched, no decoding — preview text is cosmetic only and never reaches a driver.
func LiteralRenderer(_ string, value *string) (string, error) {
	if value == nil {
		return "NULL", nil
	}
	return "'" + strings.ReplaceAll(*value, "'", "''") + "'", nil
}

// DecodeBinaryCellText decodes the app-wide "0x<hex>" binary-cell display convention (each SQL
// adapter's own read.go cellText/normalizeCellText) back into raw bytes.
func DecodeBinaryCellText(text string) ([]byte, error) {
	trimmed := strings.TrimPrefix(strings.TrimPrefix(text, "0x"), "0X")
	decoded, err := hex.DecodeString(trimmed)
	if err != nil {
		return nil, New(CodeQuery, "not a valid 0x<hex> binary value", err)
	}
	return decoded, nil
}

// NewParamRenderer is mutate()'s renderer — pushes onto params and returns the dialect's
// placeholder for the position it landed at. isBinary reports whether name is a binary-typed
// column: such a column's value arrives here still spelled in the "0x<hex>" display convention
// (read unchanged, or hand-edited) and must be decoded into raw bytes before being bound — handing
// the driver that display string as-is silently corrupts the column's real bytes on every edit
// (P2 R1 finding), since it is the ASCII text "0x4142" that gets stored, not the two bytes it
// denotes.
func NewParamRenderer(placeholder func(int) string, isBinary func(name string) bool) ValueRenderer {
	return func(name string, value *string, params *[]any) (string, error) {
		if value != nil && isBinary(name) {
			decoded, err := DecodeBinaryCellText(*value)
			if err != nil {
				return "", New(CodeQuery, "column "+name+": "+err.Error(), nil)
			}
			*params = append(*params, decoded)
			return placeholder(len(*params)), nil
		}
		*params = append(*params, value)
		return placeholder(len(*params)), nil
	}
}

func whereFromKey(key model.RowValues, render ValueRenderer, params *[]any, quote func(string) string) (string, error) {
	parts := make([]string, len(key))
	for i, kv := range key {
		if kv.Value == nil {
			parts[i] = quote(kv.Name) + " IS NULL"
		} else {
			rendered, err := render(kv.Name, kv.Value, params)
			if err != nil {
				return "", err
			}
			parts[i] = quote(kv.Name) + " = " + rendered
		}
	}
	return strings.Join(parts, " AND "), nil
}

// RenderRowOp ports sql-mutate.ts's renderRowOp: UPDATE/DELETE/INSERT text for one row op, with
// the WHERE built from the row key. quote is the caller's own quoteIdent.
func RenderRowOp(relationSQL string, op model.MutationRowOp, render ValueRenderer, params *[]any, quote func(string) string) (string, error) {
	switch op.Kind {
	case "update":
		setParts := make([]string, len(op.Changes))
		for i, kv := range op.Changes {
			rendered, err := render(kv.Name, kv.Value, params)
			if err != nil {
				return "", err
			}
			setParts[i] = quote(kv.Name) + " = " + rendered
		}
		where, err := whereFromKey(op.Key, render, params, quote)
		if err != nil {
			return "", err
		}
		return "UPDATE " + relationSQL + " SET " + strings.Join(setParts, ", ") + " WHERE " + where, nil
	case "delete":
		where, err := whereFromKey(op.Key, render, params, quote)
		if err != nil {
			return "", err
		}
		return "DELETE FROM " + relationSQL + " WHERE " + where, nil
	default: // "insert"
		columns := make([]string, len(op.Values))
		values := make([]string, len(op.Values))
		for i, kv := range op.Values {
			columns[i] = quote(kv.Name)
			rendered, err := render(kv.Name, kv.Value, params)
			if err != nil {
				return "", err
			}
			values[i] = rendered
		}
		return "INSERT INTO " + relationSQL + " (" + strings.Join(columns, ", ") + ") VALUES (" +
			strings.Join(values, ", ") + ")", nil
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
