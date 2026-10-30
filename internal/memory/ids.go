package memory

import (
	"regexp"
	"strconv"

	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
	"github.com/kirathecat/kira-studio/internal/shortid"
)

const (
	idLen = 12

	factIDPrefix  = "km_"
	groupIDPrefix = "kg_"
)

// FactIDPattern matches a fact id inside text (word-boundary grep).
var FactIDPattern = regexp.MustCompile(`\b` + memfmt.FactID + `\b`)

var factIDExact = regexp.MustCompile(`^` + memfmt.FactID + `$`)

func newID(prefix string) (string, error) {
	n, err := shortid.New(idLen)
	if err != nil {
		return "", err
	}
	return prefix + n, nil
}

func newFactID() (string, error)  { return newID(factIDPrefix) }
func newGroupID() (string, error) { return newID(groupIDPrefix) }

// versionID is the id of one version of a fact: "<fact id>.<version>".
func versionID(factID string, version int) string { return factID + "." + strconv.Itoa(version) }
