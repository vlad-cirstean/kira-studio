package agentmcp

import (
	"fmt"
	"net/url"
	"strings"
)

// Artifact limits, shared by the tool, the engine and the bridge.
const (
	MaxArtifactsPerCall = 20
	MaxArtifactsPerTask = 200
	MaxArtifactTitle    = 200
	MaxArtifactURL      = 2048
	MaxArtifactRef      = 512
)

// Artifact kinds an agent or the user may report. Detected kinds (branch) are never reported.
const (
	ArtifactChangeRequest = "changeRequest"
	ArtifactIssue         = "issue"
	ArtifactDeployment    = "deployment"
	ArtifactDoc           = "doc"
	ArtifactLink          = "link"
)

// ReportableArtifactKind reports whether a kind may be reported.
func ReportableArtifactKind(kind string) bool {
	switch kind {
	case ArtifactChangeRequest, ArtifactIssue, ArtifactDeployment, ArtifactDoc, ArtifactLink:
		return true
	}
	return false
}

// ArtifactInput is one artifact an agent reports: a url (http or https) or a ref (a file path, a
// name), plus a title.
type ArtifactInput struct {
	Kind  string `json:"kind"`
	Title string `json:"title"`
	URL   string `json:"url,omitempty"`
	Ref   string `json:"ref,omitempty"`
}

// Artifact is one artifact as an agent reads it.
type Artifact struct {
	Kind   string `json:"kind"`
	Title  string `json:"title"`
	URL    string `json:"url,omitempty"`
	Ref    string `json:"ref,omitempty"`
	Status string `json:"status,omitempty"`
	Repo   string `json:"repo,omitempty"`
	Source string `json:"source"`
}

// ArtifactGap names a source whose artifacts are missing from the list.
type ArtifactGap struct {
	Source string `json:"source"`
	Repo   string `json:"repo,omitempty"`
}

// TaskArtifacts is every artifact of a task; Gaps lists the sources that failed, so the list is partial.
type TaskArtifacts struct {
	Artifacts []Artifact    `json:"artifacts"`
	Gaps      []ArtifactGap `json:"gaps"`
}

// ReportArtifactsResult is report_artifacts' answer.
type ReportArtifactsResult struct {
	Recorded int `json:"recorded"`
}

// CleanArtifact trims an input and returns it, or the refusal text when it breaks a rule.
func CleanArtifact(in ArtifactInput) (ArtifactInput, string) {
	in.Kind, in.Title = strings.TrimSpace(in.Kind), strings.TrimSpace(in.Title)
	in.URL, in.Ref = strings.TrimSpace(in.URL), strings.TrimSpace(in.Ref)
	switch {
	case !ReportableArtifactKind(in.Kind):
		return in, "kind must be changeRequest, issue, deployment, doc or link."
	case in.Title == "":
		return in, "title must not be empty."
	case len(in.Title) > MaxArtifactTitle:
		return in, fmt.Sprintf("title is too long: at most %d bytes.", MaxArtifactTitle)
	case in.URL == "" && in.Ref == "":
		return in, "give a url or a ref."
	case len(in.URL) > MaxArtifactURL:
		return in, fmt.Sprintf("url is too long: at most %d bytes.", MaxArtifactURL)
	case len(in.Ref) > MaxArtifactRef:
		return in, fmt.Sprintf("ref is too long: at most %d bytes.", MaxArtifactRef)
	}
	if in.URL != "" {
		u, err := url.Parse(in.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return in, "url must be an absolute http or https address."
		}
	}
	return in, ""
}
