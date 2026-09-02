package testsupport

import (
	"os"
	"strings"
)

// ImageFor returns the container image for kind. An on-demand compatibility run (P16,
// scripts/db-compat.sh) overrides the pinned default through KIRA_COMPAT_IMAGE_<KIND>; with the
// variable unset every caller gets exactly the image it pinned before P16, so `bun run test:go`
// and CI are unchanged. See docs/v1.1/plans/P16-db-compat-suite.md §4 D2.
func ImageFor(kind, pinned string) string {
	v := strings.TrimSpace(os.Getenv("KIRA_COMPAT_IMAGE_" + strings.ToUpper(kind)))
	if v == "" {
		return pinned
	}
	return v
}

// ServerMajor returns the major-version component of the image tag resolved for kind ("17" for
// postgres:17-alpine, "12" for mariadb:12.3, "8" for mongo:8.3), or "" when the tag carries no
// leading number (":latest", a digest pin). Conformance suites build their own ServerVersion
// assertion from it, so running against a different image still asserts the version that was
// actually asked for instead of asserting nothing. See
// docs/v1.1/plans/P16-db-compat-suite.md §4 D4 for the parsing rule.
func ServerMajor(kind, pinned string) string {
	image := ImageFor(kind, pinned)
	// A "@sha256:…" digest suffix is never the tag — strip it before hunting for a ":tag", so a
	// digest-only pin (no tag at all) correctly falls through to "".
	if i := strings.Index(image, "@"); i >= 0 {
		image = image[:i]
	}
	_, tag, ok := strings.Cut(lastSegment(image), ":")
	if !ok {
		return ""
	}
	tag, _, _ = strings.Cut(tag, "-")
	end := 0
	for end < len(tag) && tag[end] >= '0' && tag[end] <= '9' {
		end++
	}
	return tag[:end]
}

// lastSegment isolates the "name:tag" portion of an image reference from any registry/namespace
// path segments, so a ':' inside a namespaced name's path (there is none here, but a future
// registry-host:port prefix would have one) is never mistaken for the tag separator.
func lastSegment(image string) string {
	if i := strings.LastIndex(image, "/"); i >= 0 {
		return image[i+1:]
	}
	return image
}
