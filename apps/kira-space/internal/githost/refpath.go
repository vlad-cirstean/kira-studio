package githost

import (
	"net/url"
	"strings"
)

// RefPath escapes a branch name for a URL path: each "/"-separated segment is escaped, the
// separators stay.
func RefPath(branch string) string {
	parts := strings.Split(branch, "/")
	for i, s := range parts {
		parts[i] = url.PathEscape(s)
	}
	return strings.Join(parts, "/")
}
