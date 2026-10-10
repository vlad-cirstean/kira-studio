package docker

import "testing"

func TestRegistryURL(t *testing.T) {
	const dg = "@sha256:abc"
	cases := []struct {
		name         string
		tags, digest []string
		want         string
	}{
		{"no digest", []string{"alpine:3"}, nil, ""},
		{"hub official", []string{"alpine:3"}, []string{"alpine" + dg}, "https://hub.docker.com/_/alpine"},
		{"hub user", []string{"me/app:1"}, []string{"me/app" + dg}, "https://hub.docker.com/r/me/app"},
		{"hub explicit host", nil, []string{"docker.io/library/nginx" + dg}, "https://hub.docker.com/_/nginx"},
		{"hub index host", nil, []string{"index.docker.io/me/app" + dg}, "https://hub.docker.com/r/me/app"},
		{"mirror", []string{"mirror.gcr.io/library/alpine:3.20"}, []string{"mirror.gcr.io/library/alpine" + dg}, "https://hub.docker.com/_/alpine"},
		{"digest matching tag repo", []string{"me/app:1"}, []string{"other/x" + dg, "me/app" + dg}, "https://hub.docker.com/r/me/app"},
		{"digest fallback first", []string{"local:1"}, []string{"me/app" + dg}, "https://hub.docker.com/r/me/app"},
		{"ghcr", nil, []string{"ghcr.io/o/p/sub" + dg}, "https://ghcr.io/o/p/sub"},
		{"quay", nil, []string{"quay.io/ns/r" + dg}, "https://quay.io/repository/ns/r"},
		{"gcr", nil, []string{"eu.gcr.io/proj/img/x" + dg}, "https://console.cloud.google.com/gcr/images/proj/global/img/x"},
		{"pkg.dev", nil, []string{"europe-west1-docker.pkg.dev/proj/repo/img" + dg}, "https://console.cloud.google.com/artifacts/docker/proj/europe-west1/repo/img"},
		{"ecr", nil, []string{"123456789012.dkr.ecr.us-east-1.amazonaws.com/team/app" + dg}, "https://us-east-1.console.aws.amazon.com/ecr/repositories/private/123456789012/team/app?region=us-east-1"},
		{"ecr public", nil, []string{"public.ecr.aws/alias/repo" + dg}, "https://gallery.ecr.aws/alias/repo"},
		{"mcr", nil, []string{"mcr.microsoft.com/dotnet/sdk" + dg}, "https://mcr.microsoft.com/artifact/mar/dotnet/sdk"},
		{"localhost", nil, []string{"localhost/app" + dg}, ""},
		{"port host", nil, []string{"registry.local:5000/app" + dg}, ""},
		{"gitlab", nil, []string{"registry.gitlab.com/g/p" + dg}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := registryURL(c.tags, c.digest); got != c.want {
				t.Fatalf("got %q want %q", got, c.want)
			}
		})
	}
}
