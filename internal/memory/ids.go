package memory

import (
	"regexp"
	"strconv"

	gonanoid "github.com/matoous/go-nanoid/v2"
)

const (
	// idAlphabet is Crockford base32 lowercase: no i, l, o, u look-alikes.
	idAlphabet = "0123456789abcdefghjkmnpqrstvwxyz"
	idLen      = 12

	factIDPrefix  = "km_"
	groupIDPrefix = "kg_"
)

// FactIDPattern matches a fact id inside text (word-boundary grep).
var FactIDPattern = regexp.MustCompile(`\bkm_[0-9a-hjkmnp-tv-z]{12}\b`)

var factIDExact = regexp.MustCompile(`^km_[0-9a-hjkmnp-tv-z]{12}$`)

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
