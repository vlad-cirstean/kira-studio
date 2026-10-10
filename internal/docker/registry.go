package docker

import (
	"regexp"
	"strings"
)

var ecrHost = regexp.MustCompile(`^(\d+)\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com$`)

// hubHosts all serve Docker Hub content.
var hubHosts = map[string]bool{
	"docker.io": true, "index.docker.io": true, "registry-1.docker.io": true, "mirror.gcr.io": true,
}

// splitRef splits an image reference into registry host and repository path,
// dropping tag and digest. Docker Hub references get host docker.io and the library/ prefix.
func splitRef(ref string) (host, path string) {
	if i := strings.Index(ref, "@"); i >= 0 {
		ref = ref[:i]
	}
	parts := strings.Split(ref, "/")
	if len(parts) > 1 && (strings.ContainsAny(parts[0], ".:") || parts[0] == "localhost") {
		host, parts = parts[0], parts[1:]
	}
	last := len(parts) - 1
	if i := strings.LastIndex(parts[last], ":"); i >= 0 {
		parts[last] = parts[last][:i]
	}
	path = strings.Join(parts, "/")
	if host == "" || hubHosts[host] {
		host = "docker.io"
		if len(parts) == 1 {
			path = "library/" + path
		}
	}
	return host, path
}

// registryURL returns the web page of the image's registry repository, or "" when the
// image has no digest (never pushed or pulled) or the registry has no known page layout.
func registryURL(tags, repoDigests []string) string {
	if len(repoDigests) == 0 {
		return ""
	}
	ref := repoDigests[0]
	if len(tags) > 0 {
		th, tp := splitRef(tags[0])
		for _, d := range repoDigests {
			if dh, dp := splitRef(d); dh == th && dp == tp {
				ref = d
				break
			}
		}
	}
	host, path := splitRef(ref)
	segs := strings.Split(path, "/")
	switch {
	case host == "docker.io":
		if len(segs) != 2 {
			return ""
		}
		if segs[0] == "library" {
			return "https://hub.docker.com/_/" + segs[1]
		}
		return "https://hub.docker.com/r/" + path
	case host == "ghcr.io":
		if len(segs) < 2 {
			return ""
		}
		return "https://ghcr.io/" + path
	case host == "quay.io":
		if len(segs) < 2 {
			return ""
		}
		return "https://quay.io/repository/" + path
	case host == "gcr.io" || strings.HasSuffix(host, ".gcr.io"):
		if len(segs) < 2 {
			return ""
		}
		return "https://console.cloud.google.com/gcr/images/" + segs[0] + "/global/" + strings.Join(segs[1:], "/")
	case strings.HasSuffix(host, "-docker.pkg.dev"):
		if len(segs) < 3 {
			return ""
		}
		loc := strings.TrimSuffix(host, "-docker.pkg.dev")
		return "https://console.cloud.google.com/artifacts/docker/" + segs[0] + "/" + loc + "/" + segs[1] + "/" + strings.Join(segs[2:], "/")
	case ecrHost.MatchString(host):
		m := ecrHost.FindStringSubmatch(host)
		return "https://" + m[2] + ".console.aws.amazon.com/ecr/repositories/private/" + m[1] + "/" + path + "?region=" + m[2]
	case host == "public.ecr.aws":
		if len(segs) < 2 {
			return ""
		}
		return "https://gallery.ecr.aws/" + path
	case host == "mcr.microsoft.com":
		return "https://mcr.microsoft.com/artifact/mar/" + path
	}
	return ""
}
