package memory

import (
	"regexp"
	"strconv"

	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

const (
	// idAlphabet is Crockford base32 lowercase: no i, l, o, u look-alikes.
	idAlphabet = "0123456789abcdefghjkmnpqrstvwxyz"
	idLen      = 12

	factIDPrefix  = "km_"
	groupIDPrefix = "kg_"
)

// FactIDPattern matches a fact id inside text (word-boundary grep).
var FactIDPattern = regexp.MustCompile(`\b` + memfmt.FactID + `\b`)

var factIDExact = regexp.MustCompile(`^` + memfmt.FactID + `$`)

func newID(prefix string) (string, error) {
	n, err := gonanoid.Generate(idAlphabet, idLen)
	if err != nil {
		return "", err
	}
	return prefix + n, nil
}

func newFactID() (string, error)  { return newID(factIDPrefix) }
func newGroupID() (string, error) { return newID(groupIDPrefix) }

// versionID is the id of one version of a fact: "<fact id>.<version>".
func versionID(factID string, version int) string { return factID + "." + strconv.Itoa(version) }
