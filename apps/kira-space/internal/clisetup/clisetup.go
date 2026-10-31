// Package clisetup is the shape of a provider-owned "install and sign in" how-to for a local CLI.
// Settings renders it for every code host and issue tracker, so one shape serves both roles.
package clisetup

// Step purposes. The UI labels each from its own i18n key.
const (
	PurposeInstall    = "install"
	PurposeLogin      = "login"
	PurposeLoginToken = "loginToken"
	PurposeCheck      = "check"
)

// Step is one command the user runs, shown verbatim and copyable.
type Step struct {
	Purpose string `json:"purpose"`
	Command string `json:"command"`
}

// Setup is how to install and sign in to one CLI, in order.
type Setup struct {
	DocsURL string `json:"docsUrl"`
	Steps   []Step `json:"steps"`
}
