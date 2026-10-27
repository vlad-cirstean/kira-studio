package githost

// Terms is a provider's display text.
type Terms struct {
	Label              string `json:"label"`              // "GitHub"
	ChangeRequest      string `json:"changeRequest"`      // "Pull request" (sentence start)
	ChangeRequestNoun  string `json:"changeRequestNoun"`  // "pull request" (mid-sentence)
	ChangeRequestShort string `json:"changeRequestShort"` // "PR"
	CLI                string `json:"cli"`                // "GitHub CLI (gh)"; "" when the host needs no CLI
}

// Info is what the UI needs to name one provider.
type Info struct {
	ID string `json:"id"`
	Terms
}

// Describe projects p onto Info.
func Describe(p Provider) Info {
	return Info{ID: p.ID(), Terms: p.Terms()}
}

// Providers is the wire result of listing every registered provider.
type Providers struct {
	Providers []Info `json:"providers"`
}
