package harness

// Interactive builds the shell command of a TUI session.
type Interactive interface {
	// InteractiveCommand is the shell command line of a TUI session, without its first prompt.
	InteractiveCommand(s InteractiveSpec) string
	// WithPrompt appends the first prompt after any trailing variadic flag.
	WithPrompt(command, prompt string) string
}

// InteractiveSpec describes one TUI launch. Bin defaults to the provider's Command.
type InteractiveSpec struct {
	Bin       string
	SessionID string
	// Resume continues SessionID instead of starting it.
	Resume       bool
	AddDirs      []string
	MCPConfig    string
	AllowedTools []string
}
