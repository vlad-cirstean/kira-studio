package dbmcp

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// modes is one connection's three MCP permission words (M2 §4.1), each one of deny/allow/prompt.
type modes struct{ read, write, ddl string }

// modesOf reads c's own MCP permission fields.
func modesOf(c model.ConnectionSummary) modes {
	return modes{read: c.McpReadMode, write: c.McpWriteMode, ddl: c.McpDdlMode}
}

// strictnessRank orders the three modes from least to most permissive: deny beats prompt beats
// allow, so the strictest of several modes is the one with the lowest rank.
var strictnessRank = map[string]int{"deny": 0, "prompt": 1, "allow": 2}

// strictestOf returns the strictest (lowest-ranked) of the three configured modes — an
// unclassifiable statement must never be easier to run than the statement it might be.
func (m modes) strictestOf() string {
	strictest := m.read
	for _, other := range []string{m.write, m.ddl} {
		if strictnessRank[other] < strictnessRank[strictest] {
			strictest = other
		}
	}
	return strictest
}

// verdictFor returns the mode governing class: the named one for read/write/ddl, and for
// ClassUnknown the strictest of the three.
func verdictFor(m modes, class adapters.OpClass) string {
	switch class {
	case adapters.ClassRead:
		return m.read
	case adapters.ClassWrite:
		return m.write
	case adapters.ClassDDL:
		return m.ddl
	default:
		return m.strictestOf()
	}
}
