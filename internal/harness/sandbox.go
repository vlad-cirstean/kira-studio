package harness

// Sandboxed describes what a confined run needs from the agent.
type Sandboxed interface {
	// SandboxNeeds is what the agent itself needs inside a confined run. bin is the resolved CLI
	// path, "" when it was not found.
	SandboxNeeds(home, bin string) SandboxNeeds
	// SandboxDenies are tool denials that back the profile (the only layer off macOS).
	SandboxDenies(readOnly bool, readDirs []string, network bool) []string
	// APIHosts is the network allowlist of a run with the network off: exact hosts and domain
	// suffixes (each also matches its subdomains).
	APIHosts(getenv func(string) string) (exact, suffixes []string)
	// IsAuthFailure reports whether a stderr or result text reads as a failed sign-in.
	IsAuthFailure(text string) bool
}

// SandboxNeeds are absolute paths unless noted.
type SandboxNeeds struct {
	// InstallPrefix is the read-only install tree of the CLI.
	InstallPrefix string
	// ConfigDirs are home config dirs the agent reads and writes; user paths may not cover them.
	ConfigDirs []string
	// ConfigFiles are home config file prefixes the agent reads and writes (regex prefix match).
	ConfigFiles []string
	// ProtectFiles are config files never written, relative to ConfigDirs[0].
	ProtectFiles []string
	// ProtectDirs are config dirs never written (hooks run unsandboxed), relative to ConfigDirs[0].
	ProtectDirs []string
	// QuietEnv is the environment of a run with the network off.
	QuietEnv []string
}
