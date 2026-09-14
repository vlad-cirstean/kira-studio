package appupdate

import "testing"

func TestIsReleaseBuild(t *testing.T) {
	cases := []struct {
		version string
		want    bool
	}{
		{"0.0.0", false},
		{"0.0.0-dev", false},
		{"0.0.0-unknown", false},
		{"1.3.0", true},
		{"v1.3.0", true},
		{"1.3.0-rc.1", true},
		{"not-a-version", false},
	}
	for _, tc := range cases {
		if got := isReleaseBuild(tc.version); got != tc.want {
			t.Errorf("isReleaseBuild(%q) = %v, want %v", tc.version, got, tc.want)
		}
	}
}

func TestNormalize(t *testing.T) {
	if got, want := normalize("1.3.0"), normalize("v1.3.0"); got != want {
		t.Errorf("normalize(%q) = %q, normalize(%q) = %q, want equal", "1.3.0", got, "v1.3.0", want)
	}
	if got, want := normalize("1.3.0"), "v1.3.0"; got != want {
		t.Errorf("normalize(%q) = %q, want %q", "1.3.0", got, want)
	}
}

func TestUpdateAvailable(t *testing.T) {
	cases := []struct {
		name    string
		running string
		latest  string
		want    bool
	}{
		{"newer available", "1.2.0", "1.3.0", true},
		{"newer available, tag-shaped inputs", "v1.2.0", "v1.3.0", true},
		{"equal is not newer", "1.3.0", "1.3.0", false},
		{"older is not newer", "1.3.0", "1.2.0", false},
		{"prerelease sorts below release", "1.3.0", "1.3.0-rc.1", false},
		{"release is newer than its own prerelease", "1.3.0-rc.1", "1.3.0", true},
		{"unparseable latest yields no update", "1.2.0", "not-a-version", false},
		{"unparseable running yields no update", "not-a-version", "1.3.0", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := updateAvailable(tc.running, tc.latest); got != tc.want {
				t.Errorf("updateAvailable(%q, %q) = %v, want %v", tc.running, tc.latest, got, tc.want)
			}
		})
	}
}

func TestSafeReleaseURL(t *testing.T) {
	const valid = "https://github.com/" + repoOwner + "/" + repoName + "/releases/tag/v1.3.0"
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"real shape accepted", valid, valid},
		{"wrong scheme rejected", "http://github.com/" + repoOwner + "/" + repoName + "/releases/tag/v1.3.0", releasesPageURL},
		{"wrong host rejected", "https://evil.example.com/" + repoOwner + "/" + repoName + "/releases/tag/v1.3.0", releasesPageURL},
		{"right host, foreign path rejected", "https://github.com/someone-else/other-repo/releases/tag/v1.3.0", releasesPageURL},
		{"right host, non-releases path rejected", "https://github.com/" + repoOwner + "/" + repoName + "/issues/1", releasesPageURL},
		{"unparseable URL rejected", "://not a url", releasesPageURL},
		{"javascript scheme rejected", "javascript:alert(1)", releasesPageURL},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := safeReleaseURL(tc.raw); got != tc.want {
				t.Errorf("safeReleaseURL(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}
